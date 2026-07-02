import pandas as pd
import json

file_path = "Ocak 2026 Güncel fiyat Listesi.xlsx"
df = pd.read_excel(file_path, nrows=5)
print("Columns:", df.columns.tolist())
print("Sample Data:")
print(df.to_dict(orient='records'))
