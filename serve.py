#!/usr/bin/env python3
"""Dev server with caching disabled: python3 serve.py [port]"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8737
print(f'Serving on http://localhost:{port}')
HTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
