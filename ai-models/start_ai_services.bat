@echo off
echo Starting AI Trading Bot Services...

echo Activating Python environment...
call ai_env\Scripts\activate

echo Starting AI Prediction Service...
start "AI Service" python ai_prediction_service.py

echo Waiting for AI service to start...
timeout /t 10 /nobreak > nul

echo Starting sentiment analyzer...
start "Sentiment" python sentiment_analyzer.py

echo AI Services started successfully!
echo AI Service available at: http://localhost:5000
echo Health check: http://localhost:5000/health

pause