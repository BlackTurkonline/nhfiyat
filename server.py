import http.server
import socketserver
import os
import re
import subprocess
import sys
import json

PORT = 5000
DIRECTORY = "c:/Users/Asim/Desktop/Antigravity/Fiyat karşılaştırma"

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path == '/upload':
            self.handle_upload()
        else:
            self.send_response(404)
            self.end_headers()

    def handle_upload(self):
        try:
            content_type = self.headers.get('Content-Type', '')
            if 'multipart/form-data' not in content_type:
                self.send_json_response(400, {"status": "error", "message": "Geçersiz içerik tipi. Yalnızca multipart/form-data kabul edilir."})
                return

            boundary_match = re.search(r'boundary=([^;]+)', content_type)
            if not boundary_match:
                self.send_json_response(400, {"status": "error", "message": "Boundary bulunamadı."})
                return
            
            boundary = boundary_match.group(1).encode('utf-8')
            content_length = int(self.headers.get('Content-Length', 0))
            
            if content_length == 0:
                self.send_json_response(400, {"status": "error", "message": "Boş dosya gönderildi."})
                return

            # Read request body fully
            body = self.rfile.read(content_length)

            # Parse multipart body
            parts = body.split(b'--' + boundary)
            saved_files = []
            
            for part in parts:
                if not part or part == b'--\r\n' or part == b'--' or part == b'\r\n' or part == b'\r\n--':
                    continue
                
                # Strip leading \r\n
                if part.startswith(b'\r\n'):
                    part = part[2:]
                # Strip trailing \r\n
                if part.endswith(b'\r\n'):
                    part = part[:-2]

                if b'\r\n\r\n' in part:
                    headers_part, file_data = part.split(b'\r\n\r\n', 1)
                    headers_str = headers_part.decode('utf-8', errors='ignore')
                    
                    if 'filename="' in headers_str:
                        fn_match = re.search(r'filename="([^"]+)"', headers_str)
                        if fn_match:
                            filename = fn_match.group(1)
                            filename = os.path.basename(filename)
                            
                            # Ensure it is an Excel file
                            if not filename.lower().endswith('.xlsx'):
                                self.send_json_response(400, {"status": "error", "message": "Yalnızca .xlsx uzantılı Excel dosyaları yüklenebilir."})
                                return
                            
                            file_path = os.path.join(DIRECTORY, filename)
                            with open(file_path, 'wb') as f:
                                f.write(file_data)
                            saved_files.append(filename)

            if not saved_files:
                self.send_json_response(400, {"status": "error", "message": "Yüklenecek geçerli bir Excel dosyası bulunamadı."})
                return

            # Run process_data.py to aggregate the new file into data.js
            python_exe = sys.executable if sys.executable else "python"
            script_path = os.path.join(DIRECTORY, "process_data.py")
            
            print(f"Running data compilation script: {script_path}")
            result = subprocess.run([python_exe, script_path], cwd=DIRECTORY, capture_output=True, text=True)
            
            if result.returncode == 0:
                uploaded_list_str = ", ".join(saved_files)
                self.send_json_response(200, {
                    "status": "success", 
                    "message": f"'{uploaded_list_str}' başarıyla yüklendi ve veri analizi güncellendi!"
                })
            else:
                print(f"Error in process_data.py: {result.stderr}")
                self.send_json_response(500, {
                    "status": "error", 
                    "message": f"Dosya yüklendi fakat veri işlenirken hata oluştu: {result.stderr[:200]}"
                })

        except Exception as e:
            print(f"Exception in upload handler: {str(e)}")
            self.send_json_response(500, {"status": "error", "message": f"Sunucu hatası: {str(e)}"})

    def send_json_response(self, status_code, data):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(response_bytes)

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print(f"Sunucu http://localhost:{PORT} adresinde baslatildi.")
        print("Kapatmak icin Ctrl+C tuslarina basin.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nSunucu kapatiliyor...")
