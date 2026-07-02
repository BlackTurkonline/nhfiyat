@echo off
echo.
echo ========================================================
echo   OtoFiyat.io - Verileri GitHub Pages'a Gonder
echo ========================================================
echo.

:: Check if git is initialized, if not initialize it and set remote
if not exist .git (
    echo Git deposu bulunamadi. Ilklendiriliyor...
    git init
    git remote add origin https://github.com/blackturkonline/nhfiyat.git
    echo Git basariyla kuruldu ve remote adresi eklendi.
)

:: Git kimlik bilgilerini yerel olarak ayarla (hata alinmamasi icin)
git config user.name "blackturkonline"
git config user.email "blackturkonline@users.noreply.github.com"

echo.
echo Degisiklikler algilaniyor...
git add .

echo.
echo Commit olusturuluyor...
git commit -m "Fiyat listesi guncellemesi (%date% %time%)"

echo.
echo GitHub'a yukleniyor (origin main)...
git branch -M main
git push -u origin main --force

echo.
echo ========================================================
echo ISLEM TAMAMLANDI!
echo Guncellemeleriniz birkac dakika icinde online olacaktir:
echo https://blackturkonline.github.io/nhfiyat/
echo ========================================================
pause
