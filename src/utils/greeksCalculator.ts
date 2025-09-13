import { logger } from './logger';

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;  // Per day
  vega: number;   // Per 1% IV change
  rho: number;    // Per 1% interest rate change
}

export interface OptionDetails {
  spotPrice: number;
  strikePrice: number;
  timeToExpiry: number; // In years
  riskFreeRate: number; // Annual rate (0.06 = 6%)
  volatility: number;   // Annual volatility (0.20 = 20%)
  optionType: 'CE' | 'PE';
  currentPremium?: number;
}

export class GreeksCalculator {
  private readonly RISK_FREE_RATE = 0.06; // 6% annual risk-free rate (approx NSE)

  // Standard normal cumulative distribution function
  private normCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x) / Math.sqrt(2.0);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }

  // Standard normal probability density function
  private normPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  // Calculate d1 and d2 for Black-Scholes
  private calculateD1D2(details: OptionDetails): { d1: number; d2: number } {
    const { spotPrice, strikePrice, timeToExpiry, volatility } = details;
    const r = this.RISK_FREE_RATE;

    const d1 = (Math.log(spotPrice / strikePrice) +
                (r + volatility * volatility / 2) * timeToExpiry) /
               (volatility * Math.sqrt(timeToExpiry));

    const d2 = d1 - volatility * Math.sqrt(timeToExpiry);

    return { d1, d2 };
  }

  // Calculate theoretical option price using Black-Scholes
  public calculateTheoreticalPrice(details: OptionDetails): number {
    const { spotPrice, strikePrice, timeToExpiry, optionType } = details;
    const r = this.RISK_FREE_RATE;

    const { d1, d2 } = this.calculateD1D2(details);

    if (optionType === 'CE') {
      return spotPrice * this.normCDF(d1) -
             strikePrice * Math.exp(-r * timeToExpiry) * this.normCDF(d2);
    } else {
      return strikePrice * Math.exp(-r * timeToExpiry) * this.normCDF(-d2) -
             spotPrice * this.normCDF(-d1);
    }
  }

  // Calculate implied volatility from current premium
  public calculateImpliedVolatility(details: OptionDetails): number {
    if (!details.currentPremium) return details.volatility;

    let vol = 0.2; // Starting guess: 20%
    const targetPrice = details.currentPremium;
    const tolerance = 0.01;
    const maxIterations = 100;

    for (let i = 0; i < maxIterations; i++) {
      const testDetails = { ...details, volatility: vol };
      const theoreticalPrice = this.calculateTheoreticalPrice(testDetails);
      const diff = theoreticalPrice - targetPrice;

      if (Math.abs(diff) < tolerance) {
        return vol;
      }

      // Vega calculation for Newton-Raphson method
      const { d1 } = this.calculateD1D2(testDetails);
      const vega = details.spotPrice * Math.sqrt(details.timeToExpiry) * this.normPDF(d1);

      if (vega === 0) break;

      vol = vol - diff / vega;
      vol = Math.max(0.01, Math.min(5.0, vol)); // Keep vol between 1% and 500%
    }

    return vol;
  }

  // Calculate all Greeks
  public calculateGreeks(details: OptionDetails): Greeks {
    const { spotPrice, strikePrice, timeToExpiry, optionType } = details;
    const r = this.RISK_FREE_RATE;

    const { d1, d2 } = this.calculateD1D2(details);
    const normPDF_d1 = this.normPDF(d1);
    const normCDF_d1 = this.normCDF(d1);
    const normCDF_d2 = this.normCDF(d2);
    const normCDF_neg_d1 = this.normCDF(-d1);
    const normCDF_neg_d2 = this.normCDF(-d2);

    // Delta
    let delta: number;
    if (optionType === 'CE') {
      delta = normCDF_d1;
    } else {
      delta = normCDF_d1 - 1; // Usually negative for PE
    }

    // Gamma (same for CE and PE)
    const gamma = normPDF_d1 / (spotPrice * details.volatility * Math.sqrt(timeToExpiry));

    // Theta (per day, so divide by 365)
    let theta: number;
    const thetaAnnual = -(spotPrice * normPDF_d1 * details.volatility) / (2 * Math.sqrt(timeToExpiry)) -
                       r * strikePrice * Math.exp(-r * timeToExpiry);

    if (optionType === 'CE') {
      theta = (thetaAnnual - r * strikePrice * Math.exp(-r * timeToExpiry) * normCDF_d2) / 365;
    } else {
      theta = (thetaAnnual + r * strikePrice * Math.exp(-r * timeToExpiry) * normCDF_neg_d2) / 365;
    }

    // Vega (per 1% change in volatility, so divide by 100)
    const vega = (spotPrice * Math.sqrt(timeToExpiry) * normPDF_d1) / 100;

    // Rho (per 1% change in risk-free rate, so divide by 100)
    let rho: number;
    if (optionType === 'CE') {
      rho = (strikePrice * timeToExpiry * Math.exp(-r * timeToExpiry) * normCDF_d2) / 100;
    } else {
      rho = (-strikePrice * timeToExpiry * Math.exp(-r * timeToExpiry) * normCDF_neg_d2) / 100;
    }

    return {
      delta: Number(delta.toFixed(4)),
      gamma: Number(gamma.toFixed(6)),
      theta: Number(theta.toFixed(4)),
      vega: Number(vega.toFixed(4)),
      rho: Number(rho.toFixed(4))
    };
  }

  // Get risk assessment based on Greeks
  public assessRisk(greeks: Greeks, details: OptionDetails): {
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    warnings: string[];
  } {
    const warnings: string[] = [];
    let riskScore = 0;

    // Theta risk (time decay)
    const thetaRisk = Math.abs(greeks.theta) / details.currentPremium! * 100;
    if (thetaRisk > 5) {
      warnings.push(`High time decay: ${thetaRisk.toFixed(1)}% per day`);
      riskScore += 2;
    }

    // Delta risk (directional exposure)
    if (Math.abs(greeks.delta) < 0.1) {
      warnings.push('Very low delta - minimal directional exposure');
      riskScore += 1;
    }

    // Vega risk (volatility exposure)
    const vegaRisk = Math.abs(greeks.vega) / details.currentPremium! * 100;
    if (vegaRisk > 10) {
      warnings.push(`High volatility sensitivity: ${vegaRisk.toFixed(1)}%`);
      riskScore += 1;
    }

    // Time to expiry risk
    if (details.timeToExpiry < 7/365) { // Less than 7 days
      warnings.push('Expiry within 7 days - high time decay risk');
      riskScore += 3;
    }

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    if (riskScore >= 5) riskLevel = 'EXTREME';
    else if (riskScore >= 3) riskLevel = 'HIGH';
    else if (riskScore >= 1) riskLevel = 'MEDIUM';
    else riskLevel = 'LOW';

    return { riskLevel, warnings };
  }

  // Calculate portfolio Greeks (for multiple positions)
  public calculatePortfolioGreeks(positions: Array<{
    details: OptionDetails;
    quantity: number; // Number of lots
    lotSize: number;
  }>): Greeks & { totalDelta: number; totalTheta: number } {
    let totalDelta = 0;
    let totalGamma = 0;
    let totalTheta = 0;
    let totalVega = 0;
    let totalRho = 0;

    positions.forEach(position => {
      const greeks = this.calculateGreeks(position.details);
      const contracts = position.quantity * position.lotSize;

      totalDelta += greeks.delta * contracts;
      totalGamma += greeks.gamma * contracts;
      totalTheta += greeks.theta * contracts;
      totalVega += greeks.vega * contracts;
      totalRho += greeks.rho * contracts;
    });

    return {
      delta: Number(totalDelta.toFixed(2)),
      gamma: Number(totalGamma.toFixed(4)),
      theta: Number(totalTheta.toFixed(2)),
      vega: Number(totalVega.toFixed(2)),
      rho: Number(totalRho.toFixed(2)),
      totalDelta,
      totalTheta
    };
  }

  // Quick options analysis for NIFTY/BANKNIFTY
  public analyzeNiftyBankNiftyOption(
    indexName: 'NIFTY' | 'BANKNIFTY',
    spotPrice: number,
    strikePrice: number,
    optionType: 'CE' | 'PE',
    daysToExpiry: number,
    currentPremium?: number
  ): {
    greeks: Greeks;
    impliedVolatility: number;
    theoreticalPrice: number;
    riskAssessment: { riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'; warnings: string[] };
  } {
    // Estimate volatility based on index (if premium not available)
    const baseVolatility = indexName === 'BANKNIFTY' ? 0.25 : 0.20; // 25% vs 20%

    const details: OptionDetails = {
      spotPrice,
      strikePrice,
      timeToExpiry: daysToExpiry / 365,
      riskFreeRate: this.RISK_FREE_RATE,
      volatility: baseVolatility,
      optionType,
      currentPremium
    };

    // Calculate implied volatility if premium is available
    const impliedVolatility = currentPremium ?
      this.calculateImpliedVolatility(details) : baseVolatility;

    // Update details with implied volatility
    details.volatility = impliedVolatility;

    const greeks = this.calculateGreeks(details);
    const theoreticalPrice = this.calculateTheoreticalPrice(details);
    const riskAssessment = currentPremium ?
      this.assessRisk(greeks, { ...details, currentPremium }) :
      { riskLevel: 'MEDIUM' as const, warnings: ['No current premium for risk assessment'] };

    return {
      greeks,
      impliedVolatility,
      theoreticalPrice,
      riskAssessment
    };
  }
}

export const greeksCalculator = new GreeksCalculator();