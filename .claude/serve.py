import http.server
import socketserver
import os

PORT = int(__import__('sys').argv[1]) if len(__import__('sys').argv) > 1 else 3000
DIR = "/Users/user/Desktop/ux-review-plugin"

os.chdir(DIR)

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving at port {PORT}")
    httpd.serve_forever()
