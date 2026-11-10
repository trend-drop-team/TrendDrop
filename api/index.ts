import express from "express";
import app from "../backend/server";

// Keep the framework import explicit for Vercel's Express entrypoint detection.
void express;

export default app;
