//! Reading requires the actual native window on the active desktop, not a selected tab.
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Copy, Default, Serialize)]
pub struct Snapshot {
    pub foreground: bool,
    pub revision: u64,
}
fn state() -> &'static Mutex<Snapshot> {
    static STATE: OnceLock<Mutex<Snapshot>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}
pub fn snapshot() -> Snapshot {
    *state().lock().unwrap()
}
pub fn readable() -> bool {
    snapshot().foreground
}
pub fn publish(app: &AppHandle, foreground: bool) {
    let next = {
        let mut state = state().lock().unwrap();
        if state.foreground == foreground {
            return;
        }
        state.foreground = foreground;
        state.revision += 1;
        *state
    };
    eprintln!(
        "[window-presence] foreground={} revision={}",
        next.foreground, next.revision
    );
    let _ = app.emit(
        "chatmin",
        crate::model::Event::WindowPresence {
            foreground: next.foreground,
            revision: next.revision,
        },
    );
}

pub fn refresh(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSApplication, NSWindow};
        let Some(mtm) = MainThreadMarker::new() else {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || refresh(&handle));
            return;
        };
        let facts = app
            .get_window("main")
            .and_then(|w| w.ns_window().ok())
            .map(|ptr| {
                let window = unsafe { &*ptr.cast::<NSWindow>() };
                WindowFacts {
                    app_active: NSApplication::sharedApplication(mtm).isActive(),
                    key: window.isKeyWindow(),
                    visible: window.isVisible(),
                    minimized: window.isMiniaturized(),
                    active_space: window.isOnActiveSpace(),
                    session_active: mac::SESSION_ACTIVE.load(std::sync::atomic::Ordering::Relaxed),
                }
            })
            .unwrap_or_default();
        let front = facts.readable();
        if front != readable() {
            eprintln!(
                "[window-presence] app_active={} key={} visible={} minimized={} active_space={}",
                facts.app_active, facts.key, facts.visible, facts.minimized, facts.active_space
            );
        }
        publish(app, front);
    }
    #[cfg(all(desktop, not(target_os = "macos")))]
    publish(
        app,
        app.get_window("main").is_some_and(|w| {
            w.is_focused().unwrap_or(false)
                && w.is_visible().unwrap_or(false)
                && !w.is_minimized().unwrap_or(true)
        }),
    );
    #[cfg(mobile)]
    let _ = app;
}
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    mac::install(app);
    refresh(app);
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2_app_kit::*;
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
    use std::{
        ptr::NonNull,
        sync::atomic::{AtomicBool, Ordering},
    };
    pub static SESSION_ACTIVE: AtomicBool = AtomicBool::new(true);
    pub fn install(app: &AppHandle) {
        let handle = app.clone();
        let update = block2::RcBlock::new(move |_: NonNull<NSNotification>| refresh(&handle));
        let queue = NSOperationQueue::mainQueue();
        let center = NSNotificationCenter::defaultCenter();
        let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
        // Fixed observers live with the application; no polling or per-message IPC.
        unsafe {
            for name in [
                NSApplicationDidBecomeActiveNotification,
                NSApplicationDidResignActiveNotification,
                NSApplicationDidHideNotification,
                NSApplicationDidUnhideNotification,
                NSWindowDidBecomeKeyNotification,
                NSWindowDidResignKeyNotification,
                NSWindowDidMiniaturizeNotification,
                NSWindowDidDeminiaturizeNotification,
                NSWindowDidChangeOcclusionStateNotification,
                NSWindowDidEnterFullScreenNotification,
                NSWindowDidExitFullScreenNotification,
            ] {
                std::mem::forget(center.addObserverForName_object_queue_usingBlock(
                    Some(name),
                    None,
                    Some(&queue),
                    &update,
                ));
            }
            let handle = app.clone();
            let space_change = block2::RcBlock::new(move |_: NonNull<NSNotification>| {
                refresh(&handle);
                eprintln!(
                    "[window-presence] active Space changed foreground={}",
                    readable()
                );
            });
            std::mem::forget(workspace.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceActiveSpaceDidChangeNotification),
                None,
                Some(&queue),
                &space_change,
            ));
            let handle = app.clone();
            let pause = block2::RcBlock::new(move |_: NonNull<NSNotification>| {
                SESSION_ACTIVE.store(false, Ordering::Relaxed);
                publish(&handle, false);
            });
            std::mem::forget(workspace.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceSessionDidResignActiveNotification),
                None,
                Some(&queue),
                &pause,
            ));
            let handle = app.clone();
            let resume = block2::RcBlock::new(move |_: NonNull<NSNotification>| {
                SESSION_ACTIVE.store(true, Ordering::Relaxed);
                refresh(&handle);
            });
            std::mem::forget(workspace.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceSessionDidBecomeActiveNotification),
                None,
                Some(&queue),
                &resume,
            ));
        }
    }
}
#[derive(Clone, Copy, Default)]
struct WindowFacts {
    app_active: bool,
    key: bool,
    visible: bool,
    minimized: bool,
    active_space: bool,
    session_active: bool,
}
impl WindowFacts {
    fn readable(self) -> bool {
        self.app_active
            && self.visible
            && self.key
            && !self.minimized
            && self.active_space
            && self.session_active
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_key_visible_window_on_another_desktop_is_not_being_read() {
        let front = WindowFacts {
            app_active: true,
            key: true,
            visible: true,
            minimized: false,
            active_space: true,
            session_active: true,
        };
        assert!(front.readable());
        assert!(!WindowFacts {
            active_space: false,
            ..front
        }
        .readable());
        assert!(!WindowFacts {
            app_active: false,
            ..front
        }
        .readable());
        assert!(!WindowFacts {
            minimized: true,
            ..front
        }
        .readable());
        assert!(!WindowFacts {
            session_active: false,
            ..front
        }
        .readable());
    }
}
