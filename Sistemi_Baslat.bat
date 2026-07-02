@echo off
echo ========================================================
echo   OtoFiyat.io - Yerel Sunucu ve Dashboard Baslatiliyor
echo ========================================================
echo.
echo Tarayici aciliyor: http://localhost:5000
echo Sunucuyu kapatmak icin bu pencereyi kapatabilir veya
echo Ctrl+C tuslarina basabilirsiniz.
echo.

start http://localhost:5000
python server.py

pause
