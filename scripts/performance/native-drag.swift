// Real mouse drag for the native audit app: native-drag x1 y1 x2 y2 (global screen points).
import CoreGraphics
import Foundation
let a = CommandLine.arguments.dropFirst().compactMap { Double($0) }
guard a.count == 4 else { exit(2) }
func post(_ type: CGEventType, _ x: Double, _ y: Double) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?.post(tap: .cghidEventTap)
}
post(.mouseMoved, a[0], a[1]); usleep(80_000)
post(.leftMouseDown, a[0], a[1]); usleep(80_000)
let steps = 40
for i in 1...steps { let t = Double(i) / Double(steps); post(.leftMouseDragged, a[0] + (a[2] - a[0]) * t, a[1] + (a[3] - a[1]) * t); usleep(16_000) }
usleep(80_000); post(.leftMouseUp, a[2], a[3])
