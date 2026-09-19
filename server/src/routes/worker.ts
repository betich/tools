import { Elysia } from "elysia";
import { workerStatus } from "../lib/worker";

/** Lets the PDF tools say "the worker is down" before anyone uploads a gigabyte. */
export const worker = new Elysia().get("/api/pdf/worker", () => workerStatus());
