import express from "express";
import app from "./backend/server";

// Explicit root entrypoint for Vercel's Express framework detection.
void express;

export default app;
