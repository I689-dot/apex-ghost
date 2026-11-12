#!/usr/bin/env python3
"""Serves a folder of track packs over HTTP with Range requests, for testing the app's downloads (and for a phone on the
same network): python3 -I tools/godot/pack-server.py <dir> [port] [--drop-after BYTES]. --drop-after cuts the first
full download after that many bytes (the app must resume it)."""
import http.server, os, sys

root = os.path.abspath(sys.argv[1])
port = int(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 8765
drop = int(sys.argv[sys.argv.index('--drop-after') + 1]) if '--drop-after' in sys.argv else 0
dropped = set()


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        sys.stderr.write('[pack-server] ' + fmt % a + '\n')

    def do_GET(self):
        name = os.path.basename(self.path.split('?')[0])
        p = os.path.join(root, name)
        if not name or not os.path.isfile(p):
            self.send_error(404)
            return
        size = os.path.getsize(p)
        start = 0
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            start = int(rng[6:].split('-')[0] or 0)
        self.send_response(206 if start else 200)
        if start:
            self.send_header('Content-Range', f'bytes {start}-{size - 1}/{size}')
        self.send_header('Content-Length', str(size - start))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        limit = size - start
        if drop and name.endswith('.pck') and name not in dropped and start == 0:
            dropped.add(name)
            limit = min(limit, drop)
        with open(p, 'rb') as f:
            f.seek(start)
            while limit > 0:
                b = f.read(min(65536, limit))
                if not b:
                    break
                self.wfile.write(b)
                limit -= len(b)


http.server.ThreadingHTTPServer(('0.0.0.0', port), H).serve_forever()
