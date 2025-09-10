import requests
import tweepy
from textblob import TextBlob
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging
import os
from typing import Dict, List, Optional
import yfinance as yf
import re

logger = logging.getLogger(__name__)

class SentimentAnalyzer:
    """
    📰 Sentiment Analysis for NIFTY/BANKNIFTY Market Sentiment
    Analyzes news, social media, and market data for sentiment scoring
    """
    
    def __init__(self):
        self.twitter_api = None
        self.news_sources = [
            'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms',
            'https://www.moneycontrol.com/rss/business.xml',
            'https://feeds.feedburner.com/ndtvprofit-latest'
        ]
        
        # Sentiment keywords for Indian markets
        self.bullish_keywords = [
            'bull', 'bullish', 'rally', 'surge', 'boom', 'gain', 'profit', 'positive',
            'strong', 'up', 'rise', 'high', 'support', 'breakout', 'momentum',
            'optimistic', 'growth', 'recovery', 'expansion', 'upgrade', 'outperform'
        ]
        
        self.bearish_keywords = [
            'bear', 'bearish', 'crash', 'fall', 'decline', 'loss', 'negative',
            'weak', 'down', 'drop', 'low', 'resistance', 'breakdown', 'pessimistic',
            'recession', 'correction', 'downgrade', 'underperform', 'sell', 'panic'
        ]
    
    def initialize(self):
        """Initialize sentiment analyzer with API keys"""
        try:
            # Initialize Twitter API (optional)
            self.setup_twitter_api()
            logger.info("✅ Sentiment analyzer initialized")
        except Exception as e:
            logger.warning(f"⚠️ Sentiment analyzer partial initialization: {e}")
    
    def setup_twitter_api(self):
        """Setup Twitter API (if credentials available)"""
        try:
            # Twitter API credentials (set these in environment variables)
            consumer_key = os.getenv('TWITTER_CONSUMER_KEY')
            consumer_secret = os.getenv('TWITTER_CONSUMER_SECRET')
            access_token = os.getenv('TWITTER_ACCESS_TOKEN')
            access_token_secret = os.getenv('TWITTER_ACCESS_TOKEN_SECRET')
            
            if all([consumer_key, consumer_secret, access_token, access_token_secret]):
                auth = tweepy.OAuthHandler(consumer_key, consumer_secret)
                auth.set_access_token(access_token, access_token_secret)
                self.twitter_api = tweepy.API(auth)
                logger.info("✅ Twitter API initialized")
            else:
                logger.info("ℹ️ Twitter API credentials not found, skipping Twitter sentiment")
        except Exception as e:
            logger.warning(f"Twitter API setup failed: {e}")
    
    def analyze_current_sentiment(self, index_name: str) -> Dict:
        """
        Analyze current market sentiment for given index
        
        Args:
            index_name: 'NIFTY' or 'BANKNIFTY'
        
        Returns:
            Dict with sentiment scores and analysis
        """
        sentiment_data = {
            'index_name': index_name,
            'timestamp': datetime.now().isoformat(),
            'overall_score': 0.0,
            'compound_score': 0.0,
            'confidence': 0.5,
            'sources': {
                'news_sentiment': None,
                'social_sentiment': None,
                'market_sentiment': None
            },
            'keywords': {
                'bullish_count': 0,
                'bearish_count': 0,
                'total_mentions': 0
            }
        }
        
        try:
            # Analyze news sentiment
            news_sentiment = self.analyze_news_sentiment(index_name)
            sentiment_data['sources']['news_sentiment'] = news_sentiment
            
            # Analyze social media sentiment (if available)
            if self.twitter_api:
                social_sentiment = self.analyze_social_sentiment(index_name)
                sentiment_data['sources']['social_sentiment'] = social_sentiment
            
            # Analyze market data sentiment
            market_sentiment = self.analyze_market_data_sentiment(index_name)
            sentiment_data['sources']['market_sentiment'] = market_sentiment
            
            # Calculate overall sentiment
            sentiment_data = self.calculate_overall_sentiment(sentiment_data)
            
        except Exception as e:
            logger.error(f"Sentiment analysis failed for {index_name}: {e}")
            sentiment_data['error'] = str(e)
        
        return sentiment_data
    
    def analyze_news_sentiment(self, index_name: str) -> Dict:
        """Analyze sentiment from financial news"""
        try:
            # Get recent news (simplified - in production use proper news APIs)
            news_texts = self.fetch_financial_news(index_name)
            
            if not news_texts:
                return {'score': 0.0, 'confidence': 0.1, 'articles_analyzed': 0}
            
            sentiment_scores = []
            keyword_analysis = {'bullish': 0, 'bearish': 0}
            
            for text in news_texts:
                # TextBlob sentiment analysis
                blob = TextBlob(text)
                sentiment_scores.append(blob.sentiment.polarity)
                
                # Keyword-based sentiment
                text_lower = text.lower()
                bullish_matches = sum(1 for word in self.bullish_keywords if word in text_lower)
                bearish_matches = sum(1 for word in self.bearish_keywords if word in text_lower)
                
                keyword_analysis['bullish'] += bullish_matches
                keyword_analysis['bearish'] += bearish_matches
            
            avg_sentiment = np.mean(sentiment_scores) if sentiment_scores else 0
            confidence = min(1.0, len(news_texts) / 10)  # More articles = higher confidence
            
            return {
                'score': avg_sentiment,
                'confidence': confidence,
                'articles_analyzed': len(news_texts),
                'keyword_analysis': keyword_analysis
            }
            
        except Exception as e:
            logger.error(f"News sentiment analysis failed: {e}")
            return {'score': 0.0, 'confidence': 0.1, 'error': str(e)}
    
    def analyze_social_sentiment(self, index_name: str) -> Dict:
        """Analyze sentiment from social media (Twitter)"""
        if not self.twitter_api:
            return {'score': 0.0, 'confidence': 0.1, 'tweets_analyzed': 0, 'note': 'Twitter API not available'}
        
        try:
            # Search for relevant tweets
            search_terms = self.get_search_terms(index_name)
            tweets = []
            
            for term in search_terms:
                try:
                    tweet_results = tweepy.Cursor(
                        self.twitter_api.search_tweets,
                        q=term,
                        lang='en',
                        result_type='recent',
                        tweet_mode='extended'
                    ).items(20)  # Limit to prevent rate limiting
                    
                    tweets.extend([tweet.full_text for tweet in tweet_results])
                except Exception as e:
                    logger.warning(f"Twitter search failed for {term}: {e}")
                    continue
            
            if not tweets:
                return {'score': 0.0, 'confidence': 0.1, 'tweets_analyzed': 0}
            
            # Analyze tweet sentiments
            sentiment_scores = []
            for tweet in tweets:
                # Clean tweet text
                cleaned_tweet = self.clean_tweet_text(tweet)
                blob = TextBlob(cleaned_tweet)
                sentiment_scores.append(blob.sentiment.polarity)
            
            avg_sentiment = np.mean(sentiment_scores) if sentiment_scores else 0
            confidence = min(1.0, len(tweets) / 50)  # More tweets = higher confidence
            
            return {
                'score': avg_sentiment,
                'confidence': confidence,
                'tweets_analyzed': len(tweets)
            }
            
        except Exception as e:
            logger.error(f"Social sentiment analysis failed: {e}")
            return {'score': 0.0, 'confidence': 0.1, 'error': str(e)}
    
    def analyze_market_data_sentiment(self, index_name: str) -> Dict:
        """Analyze sentiment from market data patterns"""
        try:
            # Get market data for sentiment analysis
            symbol = '^NSEI' if index_name == 'NIFTY' else '^NSEBANK'
            
            # Fetch recent market data
            stock = yf.Ticker(symbol)
            hist_data = stock.history(period='5d', interval='1d')
            
            if hist_data.empty:
                return {'score': 0.0, 'confidence': 0.1, 'reason': 'No market data available'}
            
            # Calculate market sentiment indicators
            recent_returns = hist_data['Close'].pct_change().dropna()
            volume_trend = hist_data['Volume'].pct_change().dropna()
            
            # Sentiment based on price momentum
            avg_return = recent_returns.mean()
            return_volatility = recent_returns.std()
            
            # Volume-weighted sentiment
            volume_weighted_returns = (recent_returns * hist_data['Volume'].iloc[1:]).sum() / hist_data['Volume'].iloc[1:].sum()
            
            # Calculate sentiment score
            momentum_score = np.tanh(avg_return * 100)  # Normalize between -1 and 1
            volume_score = np.tanh(volume_weighted_returns * 100)
            volatility_penalty = -min(0.3, return_volatility * 10)  # Penalize high volatility
            
            market_sentiment_score = (momentum_score + volume_score + volatility_penalty) / 2
            
            return {
                'score': market_sentiment_score,
                'confidence': 0.8,  # Market data is generally reliable
                'avg_return': avg_return,
                'volatility': return_volatility,
                'volume_trend': volume_trend.mean()
            }
            
        except Exception as e:
            logger.error(f"Market data sentiment analysis failed: {e}")
            return {'score': 0.0, 'confidence': 0.1, 'error': str(e)}
    
    def calculate_overall_sentiment(self, sentiment_data: Dict) -> Dict:
        """Calculate weighted overall sentiment score"""
        sources = sentiment_data['sources']
        
        # Weights for different sources
        weights = {
            'news_sentiment': 0.4,
            'social_sentiment': 0.3,
            'market_sentiment': 0.3
        }
        
        weighted_scores = []
        total_confidence = 0
        
        for source, weight in weights.items():
            source_data = sources.get(source)
            if source_data and source_data.get('score') is not None:
                score = source_data['score']
                confidence = source_data.get('confidence', 0.5)
                
                weighted_scores.append(score * weight * confidence)
                total_confidence += weight * confidence
        
        if weighted_scores and total_confidence > 0:
            overall_score = sum(weighted_scores) / total_confidence
            sentiment_data['overall_score'] = overall_score
            sentiment_data['compound_score'] = np.tanh(overall_score * 2)  # Normalize between -1 and 1
            sentiment_data['confidence'] = min(1.0, total_confidence)
        else:
            sentiment_data['overall_score'] = 0.0
            sentiment_data['compound_score'] = 0.0
            sentiment_data['confidence'] = 0.1
        
        # Add qualitative assessment
        compound = sentiment_data['compound_score']
        if compound > 0.3:
            sentiment_data['sentiment_label'] = 'BULLISH'
        elif compound < -0.3:
            sentiment_data['sentiment_label'] = 'BEARISH'
        else:
            sentiment_data['sentiment_label'] = 'NEUTRAL'
        
        return sentiment_data
    
    def fetch_financial_news(self, index_name: str) -> List[str]:
        """Fetch recent financial news (simplified implementation)"""
        try:
            # This is a simplified implementation
            # In production, use proper news APIs like NewsAPI, Alpha Vantage, etc.
            
            search_terms = ['NIFTY', 'Indian stock market', 'NSE', 'market outlook']
            if index_name == 'BANKNIFTY':
                search_terms.extend(['Bank NIFTY', 'banking stocks', 'financial sector'])
            
            # Placeholder for news fetching
            # In real implementation, fetch from news APIs or RSS feeds
            sample_news = [
                f"Market outlook for {index_name} remains positive with strong fundamentals",
                f"{index_name} shows resilient performance amid global volatility",
                f"Technical analysis suggests bullish momentum for {index_name}",
                f"Institutional investors show confidence in {index_name} sector"
            ]
            
            return sample_news
            
        except Exception as e:
            logger.error(f"News fetching failed: {e}")
            return []
    
    def get_search_terms(self, index_name: str) -> List[str]:
        """Get relevant search terms for social sentiment"""
        base_terms = ['#NIFTY', '#NSE', '#IndianMarkets', '#StockMarket']
        
        if index_name == 'NIFTY':
            base_terms.extend(['#NIFTY50', 'NIFTY outlook', 'Indian equity'])
        elif index_name == 'BANKNIFTY':
            base_terms.extend(['#BankNIFTY', '#BankingStocks', 'banking sector India'])
        
        return base_terms
    
    def clean_tweet_text(self, tweet_text: str) -> str:
        """Clean and preprocess tweet text"""
        # Remove URLs
        tweet_text = re.sub(r'http\S+|www.\S+', '', tweet_text)
        # Remove mentions and hashtags for sentiment analysis
        tweet_text = re.sub(r'@\w+|#\w+', '', tweet_text)
        # Remove extra whitespace
        tweet_text = re.sub(r'\s+', ' ', tweet_text).strip()
        return tweet_text

# Example usage
if __name__ == "__main__":
    analyzer = SentimentAnalyzer()
    analyzer.initialize()
    
    # Test sentiment analysis
    sentiment = analyzer.analyze_current_sentiment('NIFTY')
    print(f"NIFTY Sentiment Analysis: {sentiment}")
    
    sentiment_banknifty = analyzer.analyze_current_sentiment('BANKNIFTY')
    print(f"BANKNIFTY Sentiment Analysis: {sentiment_banknifty}")