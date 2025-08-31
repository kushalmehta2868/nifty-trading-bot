declare class HealthMonitor {
    private monitorInterval;
    private lastHealthCheck;
    initialize(): Promise<void>;
    private performHealthCheck;
    private getSystemHealth;
    private analyzeHealth;
    private logHealthStatus;
    private sendHourlySummary;
    getHealthSummary(): string;
    stop(): void;
}
export declare const healthMonitor: HealthMonitor;
export {};
