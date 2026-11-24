@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/3] 네이버 API 수집 (원본 CSV 에 새 데이터만 추가)
python -X utf8 수집기\collect.py %*
echo [2/3] 분석 CSV 생성
python -X utf8 수집기\analyze.py
echo [3/3] 엑셀 보고서 생성
python -X utf8 수집기\build_excel.py
echo 완료. 반려동물_시장분석_보고서.xlsx 를 여세요.
pause
