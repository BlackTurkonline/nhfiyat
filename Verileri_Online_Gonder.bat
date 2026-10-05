@echo off
echo.
echo ========================================================
echo   OtoFiyat.io - Verileri GitHub Pages'a Gonder
echo ========================================================
echo.

:: Script klasorunde calis
cd /d "%~dp0"

:: Git PATH'te yoksa bilinen kurulum konumlarini ekle
where git >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\Git\cmd\git.exe" set "PATH=C:\Program Files\Git\cmd;%PATH%"
    if exist "C:\Program Files (x86)\Git\cmd\git.exe" set "PATH=C:\Program Files (x86)\Git\cmd;%PATH%"
    if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "PATH=%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"
)
where git >nul 2>nul
if errorlevel 1 (
    echo HATA: Git bulunamadi! Lutfen https://git-scm.com adresinden Git kurun.
    pause
    exit /b 1
)

:: Check if git is initialized, if not initialize it and set remote
if not exist .git (
    echo Git deposu bulunamadi. Ilklendiriliyor...
    git init
    git remote add origin https://github.com/BlackTurkonline/nhfiyat.git
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
git remote set-url origin https://github.com/BlackTurkonline/nhfiyat.git
git branch -M main
git push -u origin main --force

echo.
echo ========================================================
echo ISLEM TAMAMLANDI!
echo Guncellemeleriniz birkac dakika icinde online olacaktir:
echo https://BlackTurkonline.github.io/nhfiyat/
echo ========================================================
pause
