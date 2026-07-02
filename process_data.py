import pandas as pd
import json
import os
import math

def load_file(file_path, month_name):
    print(f"Loading {file_path} for {month_name}")
    df = pd.read_excel(file_path)
    # Target columns
    part_no_col = 'Parça No'
    part_name_col = 'Parça Adı'
    
    # Check if price col exists, clean columns
    df.columns = [str(c).strip() for c in df.columns]
    price_col_actual = [c for c in df.columns if 'KDV Dahil' not in c and 'Satış' in c][0]
    
    df_subset = df[[part_no_col, part_name_col, price_col_actual]].copy()
    df_subset[part_no_col] = df_subset[part_no_col].astype(str)
    df_subset = df_subset.groupby(part_no_col).first().reset_index()
    
    df_subset.rename(columns={price_col_actual: f'{month_name}_Price', part_name_col: 'Parça Adı'}, inplace=True)
    return df_subset

def process_stock_file(file_path, period_name):
    print(f"Processing stock file: {file_path} for period: {period_name}")
    df = pd.read_excel(file_path)
    df.columns = [str(c).strip() for c in df.columns]
    
    col_mapping = {
        'stokKodu': ['Stok Kodu'],
        'stokAdi': ['Stok Adı', 'Stok Adı Y.Dış', 'Stok Adi'],
        'grubu': ['Grubu'],
        'araGrubu': ['Ara Grubu'],
        'birimi': ['Birimi'],
        'miktarDevir': ['Miktar Devir'],
        'miktarGiren': ['Miktar Giren'],
        'miktarCikan': ['Miktar Çıkan', 'Miktar Cikan', 'Miktar kan'],
        'miktarKalan': ['Miktar Kalan'],
        'birimFiyat': ['Env.Birim Fiyatı', 'Env.Birim Fiyat', 'Env. Birim Fiyatı'],
        'envTutar': ['Envanter Tutarı', 'Envanter Tutar', 'Envanter Tutari'],
        'envTutarKdv': ['Envanter Tutarı KDVli', 'Envanter Tutar KDVli', 'Envanter Tutari KDVli'],
        'aktif': ['Aktif'],
        'markasi': ['Markası', 'Markas', 'Markasi']
    }
    
    actual_mapping = {}
    for key, options in col_mapping.items():
        found = False
        for opt in options:
            if opt in df.columns:
                actual_mapping[key] = opt
                found = True
                break
        if not found:
            for col in df.columns:
                col_lower = col.lower()
                if any(opt.lower() in col_lower for opt in options):
                    actual_mapping[key] = col
                    found = True
                    break
            if not found:
                actual_mapping[key] = None
                
    rows = []
    for _, row in df.iterrows():
        stok_kodu_col = actual_mapping['stokKodu']
        if stok_kodu_col is None or pd.isna(row[stok_kodu_col]):
            continue
            
        def to_num(val):
            if pd.isna(val):
                return 0
            try:
                f_val = float(val)
                if math.isnan(f_val) or math.isinf(f_val):
                    return 0
                return round(f_val, 2)
            except Exception:
                return 0
                
        def to_str(val):
            if pd.isna(val):
                return ""
            return str(val).strip()

        row_data = {
            'stokKodu':    to_str(row.get(actual_mapping['stokKodu'], '')),
            'stokAdi':     to_str(row.get(actual_mapping['stokAdi'], '')),
            'grubu':       to_str(row.get(actual_mapping['grubu'], '')),
            'araGrubu':    to_str(row.get(actual_mapping['araGrubu'], '')),
            'birimi':      to_str(row.get(actual_mapping['birimi'], 'ADET')),
            'miktarDevir':  to_num(row.get(actual_mapping['miktarDevir'], 0)),
            'miktarGiren':  to_num(row.get(actual_mapping['miktarGiren'], 0)),
            'miktarCikan':  to_num(row.get(actual_mapping['miktarCikan'], 0)),
            'miktarKalan':  to_num(row.get(actual_mapping['miktarKalan'], 0)),
            'birimFiyat':   to_num(row.get(actual_mapping['birimFiyat'], 0)),
            'envTutar':     to_num(row.get(actual_mapping['envTutar'], 0)),
            'envTutarKdv':  to_num(row.get(actual_mapping['envTutarKdv'], 0)),
            'aktif':       to_str(row.get(actual_mapping['aktif'], '')),
            'markasi':     to_str(row.get(actual_mapping['markasi'], ''))
        }
        rows.append(row_data)
        
    return rows

if __name__ == "__main__":
    base_dir = "c:/Users/Asim/Desktop/Antigravity/Fiyat karşılaştırma"
    
    month_map = {
        "ocak": 1, "şubat": 2, "subat": 2,
        "mart": 3, "nisan": 4,
        "mayıs": 5, "mayis": 5, "haziran": 6,
        "temmuz": 7, "ağustos": 8, "agustos": 8,
        "eylül": 9, "eylul": 9, "ekim": 10,
        "kasım": 11, "kasim": 11, "aralık": 12, "aralik": 12
    }
    
    all_files = [f for f in os.listdir(base_dir) if f.endswith('.xlsx') and not f.startswith('~$')]
    
    # 1. PROCESS PRICE LISTS
    price_files = [f for f in all_files if "stok" not in f.lower()]
    files = []
    for f in price_files:
        words = f.lower().replace('-', ' ').replace('_', ' ').split()
        m_num = 99
        m_name = ""
        for w in words:
            if w in month_map:
                m_num = month_map[w]
                m_name = w.capitalize()
                break
        if m_num != 99:
            files.append((f, m_name[:3].capitalize(), m_num))
            
    files.sort(key=lambda x: x[2])
    print("Found price files chronologically:", files)
    
    full_df = None
    for filename, month, m_num in files:
        full_path = os.path.join(base_dir, filename)
        if os.path.exists(full_path):
            df_month = load_file(full_path, month)
            if full_df is None:
                full_df = df_month
            else:
                full_df = pd.merge(full_df, df_month, on=['Parça No', 'Parça Adı'], how='outer')
    
    # Fill NaN prices with 0
    price_cols = [f"{m}_Price" for _, m, _ in files]
    for col in price_cols:
        if col in full_df.columns:
            full_df[col] = full_df[col].fillna(0).round(2)
            
    print(f"Total parts collected: {len(full_df)}")
    
    records = []
    for idx, row in full_df.iterrows():
        prices = [row[col] for col in price_cols if col in full_df.columns]
        prices_valid = [p for p in prices if p > 0]
        
        if len(prices_valid) == 0:
            continue
            
        first_price = prices_valid[0]
        last_price = prices_valid[-1]
        has_changed = len(set(prices_valid)) > 1
        
        pct_increase = 0
        if first_price > 0:
            pct_increase = ((last_price - first_price) / first_price) * 100
            
        is_new = (prices[0] == 0)
        is_removed = (prices[-1] == 0)
            
        record = [
            str(row['Parça No']),
            str(row['Parça Adı']),
            [row.get(f"{m}_Price", 0) for _, m, _ in files]
        ]
        records.append(record)
        
    print(f"Total processed records: {len(records)}")
    
    out_path = os.path.join(base_dir, "data.js")
    with open(out_path, "w", encoding='utf-8') as f:
        f.write("const dashboardData = ")
        json.dump({
            "months": [m for _, m, _ in files],
            "items": records
        }, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Price data exported to {out_path}")

    # 2. PROCESS STOCK LISTS
    stock_files_raw = [f for f in all_files if "stok" in f.lower()]
    stock_files = []
    for f in stock_files_raw:
        m_num = 99
        m_name = ""
        for key, val in month_map.items():
            if key in f.lower():
                m_num = val
                m_name = key.capitalize()
                break
        if m_num != 99:
            year = "2026"
            for y in range(2020, 2035):
                if str(y) in f:
                    year = str(y)
                    break
            period_name = f"{m_name} {year}"
            stock_files.append((f, period_name, m_num))
            
    stock_files.sort(key=lambda x: x[2])
    print("Found stock files chronologically:", stock_files)
    
    preloaded_stock = {}
    for filename, period_name, m_num in stock_files:
        full_path = os.path.join(base_dir, filename)
        if os.path.exists(full_path):
            try:
                rows = process_stock_file(full_path, period_name)
                preloaded_stock[period_name] = rows
            except Exception as e:
                print(f"Error processing stock file {filename}: {e}")
                
    stock_out_path = os.path.join(base_dir, "stock_data.js")
    with open(stock_out_path, "w", encoding='utf-8') as f:
        f.write("const preloadedStockData = ")
        json.dump(preloaded_stock, f, ensure_ascii=False)
        f.write(";\n")
    print(f"Stock data exported to {stock_out_path}")
