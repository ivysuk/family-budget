# 매달 1일 Windows 작업 스케줄러가 실행 — 가족통장 지난달 데이터를 읽어 요약 글을 써서
# 개인투자팀 텔레그램 봇으로 보낸다. monthly_report_prompt.txt에 자기완결적으로 담겨있음.

Set-Location "E:\클로드\personal\family-budget"
$prompt = Get-Content "E:\클로드\personal\family-budget\tools\monthly_report_prompt.txt" -Raw
$prompt | claude -p --allowedTools Bash,mcp__claude_ai_Google_Drive__read_file_content --add-dir "E:\클로드\personal\family-budget"
