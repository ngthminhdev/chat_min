//! Background avatar loading. AppKit only receives bounded, local files.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
use tauri::{AppHandle, Manager};
const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;

pub fn local_image(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() > 0 && m.len() <= MAX_AVATAR_BYTES as u64)
}
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
    })
}
fn image_lock(path: &Path) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS.get_or_init(Default::default).lock().unwrap();
    locks.retain(|_, weak| weak.strong_count() > 0);
    if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(path.to_owned(), Arc::downgrade(&lock));
    lock
}
async fn cache_remote(client: &reqwest::Client, url: &str, path: &Path) -> Option<PathBuf> {
    let lock = image_lock(path);
    let _guard = lock.lock().await;
    if local_image(path) {
        return Some(path.to_owned());
    }
    let mut response = client.get(url).send().await.ok()?.error_for_status().ok()?;
    if response.content_length().is_some_and(|n| n > MAX_AVATAR_BYTES as u64) {
        return None;
    }
    if !response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)?
        .to_str()
        .ok()?
        .starts_with("image/")
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len().saturating_add(chunk.len()) > MAX_AVATAR_BYTES {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return None;
    }
    std::fs::create_dir_all(path.parent()?).ok()?;
    let temporary = path.with_extension("part");
    let result = (|| {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
        return None;
    }
    Some(path.to_owned())
}

/// ImageIO downsamples before decode; the main thread only ever sees a 128px PNG.
fn thumbnail_bytes(bytes: &[u8]) -> Option<Vec<u8>> {
    use objc2_core_foundation::{CFBoolean, CFData, CFDictionary, CFMutableData, CFNumber, CFString, CFType};
    use objc2_image_io::*;
    let size = CFNumber::new_isize(128);
    let yes = CFBoolean::new(true);
    let no = CFBoolean::new(false);
    unsafe {
        let source_options = CFDictionary::<CFString, CFType>::from_slices(&[kCGImageSourceShouldCache], &[no.as_ref()]);
        let source = CGImageSource::with_data(&CFData::from_bytes(bytes), Some(source_options.as_opaque()))?;
        let options = CFDictionary::<CFString, CFType>::from_slices(
            &[
                kCGImageSourceCreateThumbnailFromImageAlways,
                kCGImageSourceCreateThumbnailWithTransform,
                kCGImageSourceThumbnailMaxPixelSize,
                kCGImageSourceShouldCacheImmediately,
            ],
            &[yes.as_ref(), yes.as_ref(), size.as_ref(), yes.as_ref()],
        );
        let image = source.thumbnail_at_index(0, Some(options.as_opaque()))?;
        let output = CFMutableData::new(None, 0)?;
        let destination = CGImageDestination::with_data(&output, &CFString::from_str("public.png"), 1, None)?;
        destination.add_image(&image, None);
        if !destination.finalize() {
            return None;
        }
        Some(output.to_vec())
    }
}
pub fn thumbnail_file(source: &Path, path: &Path) -> Option<PathBuf> {
    if local_image(path) {
        return Some(path.to_owned());
    }
    if !local_image(source) {
        return None;
    }
    let bytes = thumbnail_bytes(&std::fs::read(source).ok()?)?;
    std::fs::create_dir_all(path.parent()?).ok()?;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let temporary = path.with_extension("thumb-part");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)
        .ok()?;
    file.write_all(&bytes).ok()?;
    std::fs::rename(&temporary, path).ok()?;
    Some(path.to_owned())
}
pub async fn resolve(app: &AppHandle, account: &str, source: &str) -> Option<String> {
    let core = app.try_state::<Arc<crate::Core>>()?;
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    (account, source).hash(&mut hash);
    let dir = core.cache_dir.join("gchat/island-avatars");
    let key = format!("{:016x}", hash.finish());
    let raw = if source.starts_with('/') {
        PathBuf::from(source)
    } else if account.starts_with("tg-") && !source.is_empty() && source.bytes().all(|c| c.is_ascii_digit()) {
        tokio::time::timeout(Duration::from_secs(5), core.tg.download(account, source))
            .await
            .ok()?
            .ok()?
            .into()
    } else {
        let url = reqwest::Url::parse(source).ok()?;
        if url.scheme() != "https" {
            return None;
        }
        cache_remote(client(), source, &dir.join(format!("{key}.image"))).await?
    };
    let thumbnail = dir.join(format!("{key}.128.png"));
    let lock = image_lock(&thumbnail);
    let _guard = lock.lock().await;
    // Bound concurrent ImageIO work and keep it outside AppKit's main run loop.
    static DECODERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let _permit = DECODERS.acquire().await.ok()?;
    tauri::async_runtime::spawn_blocking(move || thumbnail_file(&raw, &thumbnail))
        .await
        .ok()?
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn image_server(body: Vec<u8>, claimed_size: Option<usize>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/avatar", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).await;
            let n = claimed_size.unwrap_or(body.len());
            let header = format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {n}\r\nConnection: close\r\n\r\n");
            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(&body).await;
        });
        url
    }
    #[test]
    fn thumbnail_decode_is_bounded_and_rejects_broken_data() {
        let png = thumbnail_bytes(include_bytes!("../icons/128x128@2x.png")).unwrap();
        let source = unsafe { objc2_image_io::CGImageSource::with_data(&objc2_core_foundation::CFData::from_bytes(&png), None) }.unwrap();
        assert_eq!(unsafe { source.count() }, 1);
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 128);
        assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), 128);
        assert!(thumbnail_bytes(b"broken image").is_none());
    }

    #[tokio::test]
    async fn concurrent_remote_avatars_share_a_cached_download() {
        let bytes = include_bytes!("../resources/island/telegram.png").to_vec();
        let url = image_server(bytes.clone(), None).await;
        let dir = std::env::temp_dir().join(format!("chatmin-avatar-{}-ok", crate::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("image");
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();
        let (a, b) = tokio::join!(cache_remote(&client, &url, &path), cache_remote(&client, &url, &path));
        assert_eq!(a.as_deref(), Some(path.as_path()));
        assert_eq!(b, a);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn oversized_responses_leave_no_cached_file() {
        let url = image_server(vec![0; 20], Some(MAX_AVATAR_BYTES + 1)).await;
        let dir = std::env::temp_dir().join(format!("chatmin-avatar-{}-oversize", crate::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("image");
        assert!(cache_remote(&reqwest::Client::new(), &url, &path).await.is_none());
        assert!(!path.exists());
        assert!(!path.with_extension("part").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
