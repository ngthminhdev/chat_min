//! Import Android system-picker URI grants into local files usable by uploads/asset previews.
use serde::Deserialize;
use serde_json::json;
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager};

pub struct AndroidFiles(PluginHandle<tauri::Wry>);

#[derive(Deserialize)]
struct ImportedPaths {
    paths: Vec<String>,
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("picked-files")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.chatmin.app", "FilesPlugin")?;
            app.manage(AndroidFiles(handle));
            Ok(())
        })
        .build()
}

impl AndroidFiles {
    pub async fn import(&self, paths: Vec<String>) -> Result<Vec<String>, String> {
        let imported: ImportedPaths = self.0
            .run_mobile_plugin_async("importUris", json!({ "paths": paths }))
            .await.map_err(|error| error.to_string())?;
        Ok(imported.paths)
    }
}
