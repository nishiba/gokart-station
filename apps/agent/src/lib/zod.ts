import type { ZodType } from "zod";
import { ZodError } from "zod";
import { HttpError } from "./http-errors";

export const parseWithSchema = <T>(schema: ZodType<T>, input: unknown): T => {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpError(400, "Invalid request payload.", {
        code: "invalid_request",
        issues: error.flatten(),
      });
    }

    throw error;
  }
};
