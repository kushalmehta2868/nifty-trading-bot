class IndicatorsService {
  calculateRSI(prices, period = 14) {
    const gains = [];
    const losses = [];

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    const rsiValues = [];

    for (let i = period - 1; i < gains.length; i++) {
      const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b) / period;
      const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b) / period;

      if (avgLoss === 0) {
        rsiValues.push(100);
      } else {
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        rsiValues.push(rsi);
      }
    }

    return rsiValues;
  }

  calculateEMA(prices, period) {
    const multiplier = 2 / (period + 1);
    const emaValues = [prices[0]];

    for (let i = 1; i < prices.length; i++) {
      const ema = (prices[i] * multiplier) + (emaValues[i - 1] * (1 - multiplier));
      emaValues.push(ema);
    }

    return emaValues;
  }

  calculateSMA(prices, period) {
    const smaValues = [];

    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1);
      const average = slice.reduce((a, b) => a + b) / period;
      smaValues.push(average);
    }

    return smaValues;
  }

  calculateATR(data, period = 14) {
    const trueRanges = [];

    for (let i = 1; i < data.length; i++) {
      const high = data[i].high;
      const low = data[i].low;
      const prevClose = data[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    return this.calculateSMA(trueRanges, period);
  }

  calculateVWAP(data) {
    let totalVolume = 0;
    let totalVolumePrice = 0;
    const vwapValues = [];

    for (const candle of data) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      totalVolumePrice += typical * candle.volume;
      totalVolume += candle.volume;

      vwapValues.push(totalVolumePrice / totalVolume);
    }

    return vwapValues;
  }

  getIndicators(data, config) {
    const closes = data.map(d => d.close);
    const volumes = data.map(d => d.volume);

    return {
      rsi: this.calculateRSI(closes, config.rsiPeriod),
      emaFast: this.calculateEMA(closes, config.emaFast),
      emaSlow: this.calculateEMA(closes, config.emaSlow),
      atr: this.calculateATR(data, config.atrPeriod),
      vwap: this.calculateVWAP(data),
      volumeAvg: this.calculateEMA(volumes, 20)
    };
  }
}

module.exports = new IndicatorsService();
