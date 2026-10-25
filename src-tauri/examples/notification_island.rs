//! Provider-free native preview: cargo run --example notification_island
fn main() {
    #[cfg(all(target_os = "macos", debug_assertions))]
    chatmin_lib::preview_notification_island();
    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    eprintln!("The native notification-island preview needs a macOS debug build.");
}
