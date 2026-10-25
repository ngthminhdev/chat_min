//! Theme and layout contracts for the native island.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub background: [f64; 3],
    pub foreground: [f64; 3],
    pub secondary: [f64; 3],
    pub accent: [f64; 3],
    pub border: [f64; 3],
    pub light: bool,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            background: [0.045, 0.055, 0.075],
            foreground: [0.96, 0.97, 0.99],
            secondary: [0.57, 0.61, 0.68],
            accent: [0.49, 0.74, 0.93],
            border: [0.2, 0.23, 0.28],
            light: false,
        }
    }
}
/// Room around the black shape for its light to spread into (left, right and below).
pub const GLOW: f64 = 18.0;

impl Appearance {
    /// Ink for the black notch states (compact, peek): dark-theme text whatever the app
    /// theme is; the theme accent is kept, lifted until it reads on black.
    pub fn on_black(self) -> Self {
        let luma = |c: [f64; 3]| c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        let mut accent = self.accent;
        for _ in 0..8 {
            if luma(accent) >= 0.45 {
                break;
            }
            accent = accent.map(|v| v + (1.0 - v) * 0.2);
        }
        Self {
            background: [0.0, 0.0, 0.0],
            foreground: [0.96, 0.97, 0.99],
            secondary: [0.62, 0.65, 0.71],
            accent,
            border: [0.22, 0.24, 0.28],
            light: false,
        }
    }
    pub fn valid(&self) -> bool {
        [self.background, self.foreground, self.secondary, self.accent, self.border]
            .into_iter()
            .flatten()
            .all(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Compact,
    Notice,
    Expanded,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub width: f64,
    pub height: f64,
}

pub fn layout(mode: Mode, groups: usize, notch_width: f64, screen_width: f64) -> Layout {
    let (width, height) = match mode {
        // the notch itself, grown downward: same width, a 25pt strip below the camera
        Mode::Compact => ((notch_width + 6.0).clamp(170.0, 300.0), 25.0),
        Mode::Notice => (420.0, 108.0),
        Mode::Expanded => (440.0, 78.0 + groups.clamp(1, 3) as f64 * 72.0),
    };
    Layout {
        width: width.min((screen_width - 24.0).max(1.0)),
        height,
    }
}

/// Logical desktop coordinates, including monitors left/above the built-in display.
#[derive(Clone, Copy, Debug)]
pub struct Display {
    pub id: u64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
pub fn select_display(displays: &[Display], pointer: (f64, f64), pinned: Option<u64>) -> Option<usize> {
    pinned
        .and_then(|id| displays.iter().position(|d| d.id == id))
        .or_else(|| {
            displays
                .iter()
                .position(|d| pointer.0 >= d.x && pointer.0 < d.x + d.width && pointer.1 >= d.y && pointer.1 < d.y + d.height)
        })
        .or_else(|| (!displays.is_empty()).then_some(0))
}

pub fn confirmed_hover(current: bool, event: bool, pointer_inside: bool) -> Option<bool> {
    (event != current && event == pointer_inside).then_some(event)
}
pub fn hover_expand_needed(mode: Mode, inside: bool, pending: bool) -> bool {
    mode != Mode::Expanded && inside && !pending
}
pub fn reanimate(old: Mode, new: Mode, fresh: bool, geometry_changed: bool) -> bool {
    fresh || old != new || geometry_changed
}

pub fn split_title(title: &str) -> (&str, &str) {
    title.split_once(" · ").unwrap_or((title, ""))
}
pub fn initials(title: &str) -> String {
    let words: Vec<_> = title.split_whitespace().collect();
    let mut result = words.first().and_then(|w| w.chars().next()).into_iter().collect::<String>();
    if words.len() > 1 {
        result.extend(words.last().and_then(|w| w.chars().next()));
    }
    if result.is_empty() {
        result.push('C');
    }
    result.to_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tracking_noise_and_content_updates_do_not_restart_panel_motion() {
        assert_eq!(confirmed_hover(true, false, true), None);
        assert_eq!(confirmed_hover(false, true, false), None);
        assert_eq!(confirmed_hover(false, true, true), Some(true));
        assert!(hover_expand_needed(Mode::Notice, true, false)); // grew under a stationary pointer
        assert!(!hover_expand_needed(Mode::Notice, true, true)); // retain original deadline
        assert!(!hover_expand_needed(Mode::Expanded, true, false));
        assert!(!reanimate(Mode::Expanded, Mode::Expanded, false, false));
        assert!(reanimate(Mode::Expanded, Mode::Compact, false, true));
        assert!(reanimate(Mode::Compact, Mode::Notice, true, true));
    }

    #[test]
    fn external_display_wins_under_the_pointer_and_unplugging_unpins_the_panel() {
        let displays = [
            Display {
                id: 1,
                x: 0.0,
                y: 0.0,
                width: 1512.0,
                height: 982.0,
            },
            Display {
                id: 2,
                x: -1920.0,
                y: 200.0,
                width: 1920.0,
                height: 1080.0,
            },
        ];
        assert_eq!(select_display(&displays, (-900.0, 500.0), None), Some(1));
        assert_eq!(select_display(&displays, (100.0, 500.0), Some(2)), Some(1));
        assert_eq!(select_display(&displays[..1], (-900.0, 500.0), Some(2)), Some(0));
        assert_eq!(select_display(&displays[1..], (-900.0, 500.0), None), Some(0));
        assert_eq!(select_display(&[], (0.0, 0.0), None), None);
    }

    #[test]
    fn peek_stays_small_even_when_many_chats_arrive() {
        assert_eq!(layout(Mode::Notice, 1, 190.0, 1512.0), layout(Mode::Notice, 12, 190.0, 1512.0));
        assert!(layout(Mode::Notice, 12, 190.0, 1512.0).height <= 112.0);
        assert!(layout(Mode::Expanded, 12, 190.0, 1512.0).height > 200.0);
    }
    #[test]
    fn compact_follows_the_hardware_notch_and_small_displays_fit() {
        let a = layout(Mode::Compact, 3, 190.0, 1512.0);
        let b = layout(Mode::Compact, 3, 220.0, 1512.0);
        assert!(a.width < b.width);
        assert!(a.height <= 28.0);
        for mode in [Mode::Compact, Mode::Notice, Mode::Expanded] {
            assert!(layout(mode, 12, 190.0, 360.0).width <= 336.0);
        }
    }
    #[test]
    fn appearance_rejects_invalid_channels_and_preserves_real_theme_colors() {
        let mut theme = Appearance::default();
        theme.accent = [0.7, 0.4, 0.2];
        assert!(theme.valid());
        assert_eq!(theme.accent, [0.7, 0.4, 0.2]);
        theme.background[0] = f64::NAN;
        assert!(!theme.valid());
        theme.background[0] = 1.5;
        assert!(!theme.valid());
    }
    #[test]
    fn notch_ink_is_light_on_black_even_for_a_light_theme() {
        let mut light = Appearance::default();
        light.light = true;
        light.foreground = [0.1, 0.1, 0.1];
        light.accent = [0.35, 0.1, 0.8];
        let ink = light.on_black();
        assert!(!ink.light && ink.foreground[0] > 0.9);
        assert!(ink.accent[0] * 0.2126 + ink.accent[1] * 0.7152 + ink.accent[2] * 0.0722 >= 0.45);
        let dark = Appearance::default();
        assert_eq!(dark.on_black().accent, dark.accent);
    }
    #[test]
    fn sender_and_context_are_separate_without_losing_private_preview_text() {
        assert_eq!(split_title("Linh Nguyễn · Backend Go"), ("Linh Nguyễn", "Backend Go"));
        assert_eq!(split_title("Mẹ"), ("Mẹ", ""));
        assert_eq!(initials("Linh Nguyễn"), "LN");
        assert_eq!(initials("Đặng Văn An"), "ĐA");
    }
}
