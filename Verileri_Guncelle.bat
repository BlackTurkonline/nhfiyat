@echo off
echo.
echo ========================================================
echo   OtoFiyat.io - Otomatik Liste Guncelleme Sistemi
echo ========================================================
echo.
echo Lutfen yeni ayin Excel dosyasini (Orn: "Haziran 2026.xlsx")
echo bu klasore kopyaladiginizdan emin olun.
echo.
echo Guncelleme islemi klasordeki dosyalarin buyuklugune gore
echo 30-60 saniye arasi surebilir. Lutfen pencere kapanana kadar bekleyiniz...
echo.

python process_data.py

echo.
echo ========================================================
echo HARIKA! Verileriniz basariyla guncellendi.
echo index.html sayfasini yenileyerek degisiklikleri gorebilirsiniz.
echo ========================================================
pause
