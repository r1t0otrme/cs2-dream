@echo off
title CS2 - inventar mechty
cd /d "%~dp0"
python serve.py %*
if errorlevel 1 pause
