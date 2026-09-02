import http.server
import socketserver
import os
import re
import subprocess
import sys
import json
import urllib.request
import urllib.parse
import html
import concurrent.futures

def clean_parsed_text(text):
    if not text:
        return ""
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Decode HTML entities
    text = html.unescape(text)
    # Normalize spaces
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def extract_price_from_html(html_str, query=None):
    query_clean = re.sub(r'[^\d]', '', query) if query else ""
    
    patterns = [
        r'"productPriceKDVIncluded"\s*:\s*(\d+(?:\.\d+)?)',
        r'"productPriceStr"\s*:\s*"([^"]+)"',
        r'"indirimliFiyatiStr"\s*:\s*"([^"]+)"',
        r'"urunSepetFiyatiStr"\s*:\s*"([^"]+)"',
        r'"price"\s*:\s*(\d+(?:\.\d+)?)',
        r'"price"\s*:\s*"([^"]+)"',
        r'\'price\'\s*:\s*\'([^\'\s]+)\'',
        r'\'price\'\s*:\s*(\d+(?:\.\d+)?)',
    ]
    for pat in patterns:
        matches = re.findall(pat, html_str, re.IGNORECASE)
        for m in matches:
            val = m if isinstance(m, str) else (m[0] or m[1])
            val = val.replace('?', '').replace('₺', '').strip()
            if re.match(r'^\d+[\d\.,]*$', val):
                # Reject if price digits contain query digits (false positive part number match)
                clean_digits = re.sub(r'[^\d]', '', val)
                if query_clean and len(query_clean) > 3 and query_clean in clean_digits:
                    continue
                
                if '.' in val:
                    try:
                        parts = val.split('.')
                        if len(parts) == 2 and len(parts[1]) > 2:
                            val = f"{float(val):.2f}"
                    except ValueError:
                        pass
                return val + " ₺"
                
    og_patterns = [
        r'<meta[^>]*(?:property|name)="og:price:amount"[^>]*content="([^"]+)"',
        r'<meta[^>]*(?:property|name)="product:price:amount"[^>]*content="([^"]+)"',
        r'<meta[^>]*(?:property|name)="price"[^>]*content="([^"]+)"',
    ]
    for pat in og_patterns:
        m = re.search(pat, html_str, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            if re.match(r'^\d+[\d\.,]*$', val):
                clean_digits = re.sub(r'[^\d]', '', val)
                if query_clean and len(query_clean) > 3 and query_clean in clean_digits:
                    continue
                return val + " ₺"
                
    price_mentions = re.findall(r'(\b\d[\d\.,]*\s*(?:TL|TRY|Lira|₺)|₺\s*\d[\d\.,]*)', html_str, re.IGNORECASE)
    for mention in price_mentions:
        clean_val = re.sub(r'[^\d\.,]', '', mention).strip()
        if len(clean_val) > 1 and not clean_val.endswith('.') and not clean_val.endswith(','):
            clean_digits = re.sub(r'[^\d]', '', clean_val)
            if query_clean and len(query_clean) > 3 and query_clean in clean_digits:
                continue
            return mention.strip()
            
    return None

def fetch_page_price(url, query=None):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=3) as response:
            content = response.read()
            try:
                html_str = content.decode('utf-8')
            except UnicodeDecodeError:
                html_str = content.decode('windows-1254', errors='ignore')
            return extract_price_from_html(html_str, query)
    except Exception:
        return None

def fetch_search_results(query, domain_limit=None):
    search_term = query
    if domain_limit:
        search_term = f"site:{domain_limit} {query}"

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36'
    }

    # 1. Try DuckDuckGo first
    ddg_url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(search_term)
    try:
        req = urllib.request.Request(ddg_url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as response:
            content = response.read()
            try:
                html_str = content.decode('utf-8')
            except UnicodeDecodeError:
                html_str = content.decode('windows-1254', errors='ignore')

            if "challenge" not in html_str and "captcha" not in html_str and "robot" not in html_str:
                blocks = re.findall(r'<div class="result.*?result__body">.*?<div class="clear"></div>\s*</div>\s*</div>', html_str, re.DOTALL)
                if blocks:
                    items = []
                    for b in blocks:
                        title_match = re.search(r'class="result__a"[^>]*>(.*?)</a>', b, re.DOTALL)
                        title = title_match.group(1).replace('<b>', '').replace('</b>', '').strip() if title_match else ""
                        
                        link_match = re.search(r'class="result__a"[^>]*href="([^"]+)"', b)
                        link = link_match.group(1) if link_match else ""
                        
                        snippet_match = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', b, re.DOTALL)
                        snippet = snippet_match.group(1).replace('<b>', '').replace('</b>', '').strip() if snippet_match else ""
                        
                        items.append({"title": title, "link": link, "snippet": snippet})
                    return items
    except Exception as e:
        print("DDG search failed:", e)

    # 2. Fallback to Yahoo Search if DDG failed or showed CAPTCHA
    print(f"Falling back to Yahoo Search for query: {search_term}")
    yahoo_url = "https://search.yahoo.com/search?q=" + urllib.parse.quote(search_term)
    try:
        req = urllib.request.Request(yahoo_url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as response:
            content = response.read()
            try:
                html_str = content.decode('utf-8')
            except UnicodeDecodeError:
                html_str = content.decode('windows-1254', errors='ignore')

            blocks = re.findall(r'<div[^>]*class="[^"]*algo[^"]*"[^>]*>.*?</li>', html_str, re.DOTALL)
            items = []
            for b in blocks:
                title_match = re.search(r'<h3[^>]*>(.*?)</h3>', b, re.DOTALL)
                title = title_match.group(1) if title_match else ""
                title = re.sub(r'<[^>]+>', '', title).strip()
                
                link_match = re.search(r'href="([^"]+)"', b)
                link = link_match.group(1) if link_match else ""
                
                real_link = link
                if "/RU=" in link:
                    ru_start = link.find("/RU=") + 4
                    ru_end = link.find("/", ru_start)
                    if ru_end == -1:
                        ru_end = len(link)
                    ru_encoded = link[ru_start:ru_end]
                    real_link = urllib.parse.unquote(ru_encoded)

                snippet_match = re.search(r'<div[^>]*class="[^"]*compText[^"]*"[^>]*>(.*?)</div>', b, re.DOTALL)
                snippet = snippet_match.group(1) if snippet_match else ""
                snippet = re.sub(r'<[^>]+>', '', snippet).strip()

                if title and real_link:
                    items.append({"title": title, "link": real_link, "snippet": snippet})
            return items
    except Exception as e:
        print("Yahoo search failed:", e)

    return []

PORT = 5000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        if path == '/api/sites':
            self.handle_get_sites()
        elif path == '/api/search':
            self.handle_search(query_params)
        else:
            super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == '/upload':
            self.handle_upload()
        elif path == '/api/sites':
            self.handle_save_site()
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        if path == '/api/sites':
            self.handle_delete_site(query_params)
        else:
            self.send_response(404)
            self.end_headers()

    def handle_get_sites(self):
        try:
            sites_file = os.path.join(DIRECTORY, "search_sites.json")
            if os.path.exists(sites_file):
                with open(sites_file, 'r', encoding='utf-8') as f:
                    sites = json.load(f)
            else:
                sites = []
            self.send_json_response(200, sites)
        except Exception as e:
            self.send_json_response(500, {"status": "error", "message": str(e)})

    def handle_save_site(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            site_data = json.loads(body.decode('utf-8'))

            sites_file = os.path.join(DIRECTORY, "search_sites.json")
            if os.path.exists(sites_file):
                with open(sites_file, 'r', encoding='utf-8') as f:
                    sites = json.load(f)
            else:
                sites = []

            site_id = site_data.get('id')
            if site_id:
                updated = False
                for idx, s in enumerate(sites):
                    if s.get('id') == site_id:
                        sites[idx] = site_data
                        updated = True
                        break
                if not updated:
                    sites.append(site_data)
            else:
                import uuid
                site_data['id'] = str(uuid.uuid4())
                sites.append(site_data)

            with open(sites_file, 'w', encoding='utf-8') as f:
                json.dump(sites, f, ensure_ascii=False, indent=2)

            self.send_json_response(200, {"status": "success", "site": site_data})
        except Exception as e:
            self.send_json_response(500, {"status": "error", "message": str(e)})

    def handle_delete_site(self, query_params):
        try:
            site_id = query_params.get('id', [None])[0]
            if not site_id:
                self.send_json_response(400, {"status": "error", "message": "Site ID belirtilmedi."})
                return

            sites_file = os.path.join(DIRECTORY, "search_sites.json")
            if os.path.exists(sites_file):
                with open(sites_file, 'r', encoding='utf-8') as f:
                    sites = json.load(f)
            else:
                sites = []

            new_sites = [s for s in sites if s.get('id') != site_id]

            with open(sites_file, 'w', encoding='utf-8') as f:
                json.dump(new_sites, f, ensure_ascii=False, indent=2)

            self.send_json_response(200, {"status": "success", "message": "Site silindi."})
        except Exception as e:
            self.send_json_response(500, {"status": "error", "message": str(e)})

    def handle_search(self, query_params):
        try:
            query = query_params.get('query', [None])[0]
            site_ids = query_params.get('site_ids', [None])[0]

            if not query:
                self.send_json_response(400, {"status": "error", "message": "Arama terimi belirtilmedi."})
                return

            if site_ids:
                site_ids = site_ids.split(',')
            else:
                site_ids = []

            sites_file = os.path.join(DIRECTORY, "search_sites.json")
            if os.path.exists(sites_file):
                with open(sites_file, 'r', encoding='utf-8') as f:
                    sites = json.load(f)
            else:
                sites = []

            if site_ids:
                sites_to_search = [s for s in sites if s.get('id') in site_ids]
            else:
                sites_to_search = sites

            results = {}
            for site in sites_to_search:
                site_id = site.get('id')
                search_url_template = site.get('search_url')
                card_regex = site.get('card_regex')
                title_regex = site.get('title_regex')
                price_regex = site.get('price_regex')
                link_regex = site.get('link_regex')
                base_url = site.get('base_url', '')

                if search_url_template:
                    search_url = search_url_template.replace('{query}', urllib.parse.quote(query))
                else:
                    search_url = ""

                if site_id != "google_search" and not card_regex:
                    try:
                        domain = urllib.parse.urlparse(base_url).netloc.replace('www.', '') if base_url else site_id + ".com"
                        raw_items = fetch_search_results(query, domain_limit=domain)
                        
                        items = []
                        for item in raw_items:
                            title = item.get('title', '')
                            link = item.get('link', '')
                            snippet = item.get('snippet', '')
                            
                            combined_text = title + " | " + snippet
                            price_match = re.search(r'(\b\d[\d\.,]*\s*(?:TL|TRY|Lira|₺)|₺\s*\d[\d\.,]*)', combined_text, re.IGNORECASE)
                            price = price_match.group(1).strip() if price_match else "Fiyat Tespit Edilemedi"

                            if price != "Fiyat Tespit Edilemedi":
                                query_clean = re.sub(r'[^\d]', '', query) if query else ""
                                clean_price_digits = re.sub(r'[^\d]', '', price)
                                if query_clean and len(query_clean) > 3 and query_clean in clean_price_digits:
                                    price = "Fiyat Tespit Edilemedi"

                            if title and link and domain in link:
                                title = clean_parsed_text(title)
                                price = clean_parsed_text(price)
                                items.append({
                                    "title": title,
                                    "price": price,
                                    "link": link
                                })

                        # Fetch top 4 links concurrently for real-time prices
                        urls = [item['link'] for item in items[:4] if item.get('link')]
                        real_prices = {}
                        if urls:
                            with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(urls), 4)) as executor:
                                future_to_url = {executor.submit(fetch_page_price, url, query): url for url in urls}
                                for future in concurrent.futures.as_completed(future_to_url, timeout=5):
                                    url = future_to_url[future]
                                    try:
                                        real_prices[url] = future.result()
                                    except Exception:
                                        real_prices[url] = None

                        for item in items:
                            url = item['link']
                            if url in real_prices and real_prices[url]:
                                item['price'] = real_prices[url]

                        results[site_id] = {
                            "success": True,
                            "items": items
                        }
                    except Exception as ex:
                        results[site_id] = {
                            "success": False,
                            "error": str(ex)
                        }
                    continue

                if site_id == "google_search":
                    try:
                        raw_items = fetch_search_results(query)
                        
                        items = []
                        for item in raw_items:
                            title = item.get('title', '')
                            link = item.get('link', '')
                            snippet = item.get('snippet', '')
                            
                            combined_text = title + " | " + snippet
                            price_match = re.search(r'(\b\d[\d\.,]*\s*(?:TL|TRY|Lira|₺)|₺\s*\d[\d\.,]*)', combined_text, re.IGNORECASE)
                            price = price_match.group(1).strip() if price_match else "Fiyat Tespit Edilemedi"

                            if price != "Fiyat Tespit Edilemedi":
                                query_clean = re.sub(r'[^\d]', '', query) if query else ""
                                clean_price_digits = re.sub(r'[^\d]', '', price)
                                if query_clean and len(query_clean) > 3 and query_clean in clean_price_digits:
                                    price = "Fiyat Tespit Edilemedi"

                            if title and link:
                                title = clean_parsed_text(title)
                                price = clean_parsed_text(price)
                                domain = urllib.parse.urlparse(link).netloc.replace('www.', '')
                                items.append({
                                    "title": f"[{domain}] {title}",
                                    "price": price,
                                    "link": link
                                })

                        # Fetch top 6 urls in parallel to get their real-time prices
                        urls = [item['link'] for item in items[:6] if item.get('link')]
                        real_prices = {}
                        if urls:
                            with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(urls), 6)) as executor:
                                future_to_url = {executor.submit(fetch_page_price, url, query): url for url in urls}
                                for future in concurrent.futures.as_completed(future_to_url, timeout=5):
                                    url = future_to_url[future]
                                    try:
                                        real_prices[url] = future.result()
                                    except Exception:
                                        real_prices[url] = None

                        for item in items:
                            url = item['link']
                            if url in real_prices and real_prices[url]:
                                item['price'] = real_prices[url]

                        results[site_id] = {
                            "success": True,
                            "items": items
                        }
                    except Exception as ex:
                        results[site_id] = {
                            "success": False,
                            "error": str(ex)
                        }
                    continue

                try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                    req = urllib.request.Request(search_url, headers=headers)
                    with urllib.request.urlopen(req, timeout=10) as response:
                        content = response.read()
                        
                        try:
                            html = content.decode('utf-8')
                        except UnicodeDecodeError:
                            html = content.decode('windows-1254', errors='ignore')

                        items = []
                        cards = re.findall(card_regex, html, re.DOTALL)
                        
                        for card in cards:
                            title_m = re.search(title_regex, card, re.DOTALL)
                            link_m = re.search(link_regex, card, re.DOTALL)

                            ins_m = re.search(r'<ins[^>]*>.*?<bdi>\s*(.*?)\s*</bdi>|<ins[^>]*>.*?amount[^>]*>\s*(.*?)\s*</', card, re.DOTALL)
                            if ins_m:
                                price_val = ins_m.group(1) or ins_m.group(2) or ""
                            else:
                                price_m = re.search(price_regex, card, re.DOTALL)
                                # Clean list types or empty arrays
                                price_val = ""
                                if price_m:
                                    price_val = price_m.group(1) or price_m.group(2) or ""
                                if not price_val:
                                    price_val = "Fiyat Belirtilmemiş"

                            if title_m or ins_m or (price_regex and price_m):
                                title = clean_parsed_text(title_m.group(1)) if title_m else "İsimsiz Ürün"
                                price = clean_parsed_text(price_val)
                                
                                # Reject if price digits contain query digits
                                query_clean = re.sub(r'[^\d]', '', query) if query else ""
                                clean_price_digits = re.sub(r'[^\d]', '', price)
                                if query_clean and len(query_clean) > 3 and query_clean in clean_price_digits:
                                    continue
                                    
                                link = link_m.group(1).strip() if link_m else ""

                                if link and not link.startswith('http'):
                                    if link.startswith('/'):
                                        link = base_url.rstrip('/') + link
                                    else:
                                        link = base_url.rstrip('/') + '/' + link

                                items.append({
                                    "title": title,
                                    "price": price,
                                    "link": link
                                })

                        results[site_id] = {
                            "success": True,
                            "items": items
                        }

                except Exception as ex:
                    results[site_id] = {
                        "success": False,
                        "error": str(ex)
                    }

            self.send_json_response(200, {"results": results})
        except Exception as e:
            self.send_json_response(500, {"status": "error", "message": str(e)})

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
