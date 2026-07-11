#!/usr/bin/env python3
"""Dev server with caching disabled: python3 serve.py [port]
Serves ./site (the deploy root — same layout GitHub Pages publishes)."""
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8737
print(f'Serving ./site on http://localhost:{port}')
handler = partial(NoCacheHandler, directory='site')
HTTPServer(('127.0.0.1', port), handler).serve_forever()
