"""Drives the native audit app (com.chatmin.audit) with real input: it reads AUDIT-NEED lines the
page writes to its js.log and answers with keystrokes, window resizes or a real mouse drag.
Every action first checks that the audit app is frontmost, so nothing ever reaches another app.
Usage: python3 native-driver.py <native-drag binary>"""
import os, subprocess, sys, time
LOG = os.path.expanduser('~/Library/Caches/com.chatmin.audit/js.log')
DRAG = sys.argv[1]
BID = 'com.chatmin.audit'
KEYS = {'enter': 'key code 36', 'tab': 'key code 48', 'option-tab': 'key code 48 using option down', 'cmd-down': 'key code 125 using command down',
        'right': 'key code 124', 'escape': 'key code 53'}
def osa(script):
    return subprocess.run(['osascript', '-e', script], capture_output=True, text=True).stdout.strip()
def front():
    osa(f'tell application "System Events" to set frontmost of (first process whose bundle identifier is "{BID}") to true')
    time.sleep(0.15)
    return osa('tell application "System Events" to get bundle identifier of first process whose frontmost is true') == BID
def window_origin():
    out = osa(f'tell application "System Events" to tell (first process whose bundle identifier is "{BID}") to get position of window 1')
    x, y = [int(v) for v in out.split(', ')]
    return x, y
done, start = set(), time.time()
while time.time() - start < 900:
    lines = open(LOG, errors='ignore').read().splitlines() if os.path.exists(LOG) else []
    if any('AUDIT-DONE' in l for l in lines):
        break
    for l in lines:
        i = l.find('AUDIT-NEED ')
        if i < 0: continue
        parts = l[i + 11:].split()
        nid, action, args = parts[0], parts[1], parts[2:]
        if nid in done: continue
        done.add(nid)
        if not front():
            print('skip (not frontmost)', nid, action, flush=True); continue
        if action == 'key':
            osa(f'tell application "System Events" to {KEYS[args[0]]}')
        elif action == 'resize':
            osa(f'tell application "System Events" to tell (first process whose bundle identifier is "{BID}") to set size of window 1 to {{{args[0]}, {args[1]}}}')
        elif action == 'drag':
            ox, oy = window_origin()
            x1, y1, x2, y2 = [float(v) for v in args]
            subprocess.run([DRAG, str(ox + x1), str(oy + y1), str(ox + x2), str(oy + y2)])
        print('did', nid, action, *args, flush=True)
    time.sleep(0.25)
