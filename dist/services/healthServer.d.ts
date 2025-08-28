import express from 'express';
declare class HealthServer {
    private app;
    private server;
    private readonly port;
    constructor();
    private setupMiddleware;
    private setupRoutes;
    start(): void;
    stop(): void;
    getApp(): express.Application;
}
export declare const healthServer: HealthServer;
export {};
