@echo off
title CS2 - sborschik cen
cd /d "%~dp0"
python serve.py 8787 collect.html
if errorlevel 1 pause
