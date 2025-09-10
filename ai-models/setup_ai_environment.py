#!/usr/bin/env python3
"""
🤖 AI Environment Setup Script
Sets up the complete AI infrastructure for the trading bot
"""

import os
import sys
import subprocess
import json
from pathlib import Path

def run_command(command, description):
    """Run a command and handle errors"""
    print(f"🔄 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed")
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed: {e}")
        print(f"Error output: {e.stderr}")
        return None

def setup_python_environment():
    """Set up Python virtual environment and install dependencies"""
    print("\n🐍 Setting up Python environment...")
    
    # Create virtual environment
    if not os.path.exists('ai_env'):
        run_command('python -m venv ai_env', 'Creating virtual environment')
    
    # Determine activation script path
    if sys.platform == "win32":
        activate_script = "ai_env\\Scripts\\activate"
        pip_path = "ai_env\\Scripts\\pip"
    else:
        activate_script = "ai_env/bin/activate"
        pip_path = "ai_env/bin/pip"
    
    # Install requirements
    if os.path.exists('requirements.txt'):
        run_command(f'{pip_path} install -r requirements.txt', 'Installing Python dependencies')
    else:
        # Install basic requirements
        packages = [
            'numpy==1.24.3',
            'pandas==2.0.3', 
            'scikit-learn==1.3.0',
            'tensorflow==2.13.0',
            'flask==2.3.2',
            'flask-cors==4.0.0',
            'requests==2.31.0',
            'matplotlib==3.7.1',
            'joblib==1.3.1',
            'textblob==0.17.1',
            'yfinance==0.2.18'
        ]
        
        for package in packages:
            run_command(f'{pip_path} install {package}', f'Installing {package}')
    
    return activate_script

def create_directory_structure():
    """Create necessary directories for AI system"""
    print("\n📁 Creating directory structure...")
    
    directories = [
        'models',
        'data',
        'logs',
        'exports',
        '../ai-data',
        '../ai-data/snapshots', 
        '../ai-data/outcomes',
        '../ai-data/exports'
    ]
    
    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)
        print(f"✅ Created directory: {directory}")

def create_startup_scripts():
    """Create startup scripts for AI services"""
    print("\n📜 Creating startup scripts...")
    
    # Windows batch script
    windows_script = """@echo off
echo 🤖 Starting AI Trading Bot Services...

echo 🐍 Activating Python environment...
call ai_env\\Scripts\\activate

echo 🚀 Starting AI Prediction Service...
start "AI Service" python ai_prediction_service.py

echo ⏳ Waiting for AI service to start...
timeout /t 10 /nobreak > nul

echo 📊 Starting sentiment analyzer...
start "Sentiment" python sentiment_analyzer.py

echo 🎯 AI Services started successfully!
echo 🌐 AI Service available at: http://localhost:5000
echo 📈 Health check: http://localhost:5000/health

pause
"""
    
    with open('start_ai_services.bat', 'w') as f:
        f.write(windows_script)
    
    # Linux/Mac bash script
    bash_script = """#!/bin/bash
echo "🤖 Starting AI Trading Bot Services..."

echo "🐍 Activating Python environment..."
source ai_env/bin/activate

echo "🚀 Starting AI Prediction Service..."
nohup python ai_prediction_service.py > logs/ai_service.log 2>&1 &
AI_PID=$!
echo "AI Service PID: $AI_PID"

echo "⏳ Waiting for AI service to start..."
sleep 10

echo "📊 Starting sentiment analyzer..."
nohup python sentiment_analyzer.py > logs/sentiment.log 2>&1 &
SENTIMENT_PID=$!
echo "Sentiment Analyzer PID: $SENTIMENT_PID"

echo "🎯 AI Services started successfully!"
echo "🌐 AI Service available at: http://localhost:5000"
echo "📈 Health check: http://localhost:5000/health"
echo "📋 Service PIDs saved to ai_services.pid"

echo "$AI_PID" > ai_services.pid
echo "$SENTIMENT_PID" >> ai_services.pid
"""
    
    with open('start_ai_services.sh', 'w') as f:
        f.write(bash_script)
    
    # Make executable on Unix systems
    if sys.platform != "win32":
        os.chmod('start_ai_services.sh', 0o755)
    
    print("✅ Startup scripts created")

def create_config_files():
    """Create configuration files"""
    print("\n⚙️ Creating configuration files...")
    
    # AI service configuration
    ai_config = {
        "ai_service": {
            "host": "0.0.0.0",
            "port": 5000,
            "debug": False,
            "model_path": "./models",
            "data_path": "../ai-data"
        },
        "model_training": {
            "retrain_interval_hours": 24,
            "min_samples_for_training": 100,
            "validation_split": 0.2,
            "random_state": 42
        },
        "sentiment_analysis": {
            "enable_twitter": False,
            "enable_news": True,
            "update_interval_minutes": 30,
            "sentiment_weight": 0.3
        },
        "prediction_settings": {
            "confidence_threshold": 0.6,
            "max_prediction_age_minutes": 5,
            "combine_with_technical": True,
            "override_threshold": 0.8
        }
    }
    
    with open('ai_config.json', 'w') as f:
        json.dump(ai_config, f, indent=2)
    
    # Environment variables template
    env_template = """# AI Service Configuration
AI_SERVICE_PORT=5000
FLASK_ENV=production

# Twitter API (Optional - for sentiment analysis)
TWITTER_CONSUMER_KEY=your_twitter_consumer_key
TWITTER_CONSUMER_SECRET=your_twitter_consumer_secret  
TWITTER_ACCESS_TOKEN=your_twitter_access_token
TWITTER_ACCESS_TOKEN_SECRET=your_twitter_access_token_secret

# News API (Optional)
NEWS_API_KEY=your_news_api_key

# Alpha Vantage (Optional)
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key

# Model Training Settings
MIN_TRAINING_SAMPLES=100
RETRAIN_INTERVAL_HOURS=24
"""
    
    with open('.env.template', 'w') as f:
        f.write(env_template)
    
    print("✅ Configuration files created")

def create_test_script():
    """Create test script to verify AI setup"""
    test_script = """#!/usr/bin/env python3
import requests
import json
import time

def test_ai_service():
    \"\"\"Test AI service functionality\"\"\"
    print("🧪 Testing AI Service...")
    
    base_url = "http://localhost:5000"
    
    # Test health endpoint
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Health check passed: {data}")
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Could not connect to AI service: {e}")
        return False
    
    # Test prediction endpoint
    test_data = {
        "indexName": "NIFTY",
        "currentPrice": 25000,
        "indicators": {
            "ema": 24950,
            "rsi": 65,
            "bollingerBands": {
                "upper": 25100,
                "middle": 25000,
                "lower": 24900,
                "squeeze": False
            },
            "momentum": 0.02,
            "volatility": 0.18,
            "support": 24800,
            "resistance": 25200
        },
        "marketConditions": {
            "trend": "BULLISH",
            "volatilityRegime": "MEDIUM",
            "timeOfDay": "OPENING"
        }
    }
    
    try:
        response = requests.post(f"{base_url}/predict", json=test_data, timeout=10)
        if response.status_code == 200:
            prediction = response.json()
            print(f"✅ Prediction test passed:")
            print(f"   Action: {prediction.get('tradingRecommendation', {}).get('action', 'Unknown')}")
            print(f"   Confidence: {prediction.get('confidence', 0):.2f}")
            return True
        else:
            print(f"❌ Prediction test failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Prediction test failed: {e}")
        return False

def test_sentiment_analysis():
    \"\"\"Test sentiment analysis\"\"\"
    print("\\n📊 Testing Sentiment Analysis...")
    
    try:
        response = requests.get("http://localhost:5000/sentiment/NIFTY", timeout=10)
        if response.status_code == 200:
            sentiment = response.json()
            print(f"✅ Sentiment analysis test passed:")
            print(f"   Sentiment: {sentiment.get('sentiment', {}).get('sentiment_label', 'Unknown')}")
            return True
        else:
            print(f"❌ Sentiment analysis test failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Sentiment analysis test failed: {e}")
        return False

if __name__ == "__main__":
    print("🧪 Running AI System Tests...")
    
    print("⏳ Waiting for services to start...")
    time.sleep(5)
    
    success = True
    success &= test_ai_service()
    success &= test_sentiment_analysis()
    
    if success:
        print("\\n🎉 All tests passed! AI system is ready.")
    else:
        print("\\n❌ Some tests failed. Check the service logs.")
"""
    
    with open('test_ai_system.py', 'w') as f:
        f.write(test_script)
    
    print("✅ Test script created")

def print_setup_complete():
    """Print setup completion message with instructions"""
    print("\n" + "="*60)
    print("🎉 AI SYSTEM SETUP COMPLETE!")
    print("="*60)
    
    print("\n📋 NEXT STEPS:")
    print("1. ⚙️  Configure environment variables in .env file")
    print("2. 🚀 Start AI services:")
    if sys.platform == "win32":
        print("   Windows: double-click start_ai_services.bat")
    else:
        print("   Linux/Mac: ./start_ai_services.sh")
    print("3. 🧪 Test the setup: python test_ai_system.py")
    print("4. 🎯 Update your Node.js bot to enable AI integration")
    
    print("\n🌐 SERVICE ENDPOINTS:")
    print("   • Health Check: http://localhost:5000/health")
    print("   • Predictions: http://localhost:5000/predict")
    print("   • Sentiment: http://localhost:5000/sentiment/<index>")
    print("   • Model Stats: http://localhost:5000/model-stats")
    
    print("\n📚 DOCUMENTATION:")
    print("   • AI Configuration: ai_config.json")
    print("   • Environment Variables: .env.template")
    print("   • Startup Scripts: start_ai_services.*")
    print("   • Test Script: test_ai_system.py")
    
    print("\n⚠️  IMPORTANT NOTES:")
    print("   • Collect training data for 1-2 weeks before training models")
    print("   • Set up Twitter/News API keys for sentiment analysis")
    print("   • Monitor AI service logs for performance")
    print("   • Retrain models weekly with new data")

def main():
    """Main setup function"""
    print("🤖 AI TRADING BOT SETUP")
    print("Setting up complete AI infrastructure...")
    
    # Change to ai-models directory
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    try:
        activate_script = setup_python_environment()
        create_directory_structure()
        create_startup_scripts()
        create_config_files()
        create_test_script()
        
        print_setup_complete()
        
    except Exception as e:
        print(f"\n❌ Setup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()