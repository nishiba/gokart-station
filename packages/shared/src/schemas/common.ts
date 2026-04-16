import { z } from "zod";

export const idSchema = z.string().min(1);
export const nonEmptyStringSchema = z.string().min(1);
export const isoDateTimeSchema = z.string().min(1);
export const filePathSchema = z.string().min(1);
export const urlSchema = z.string().url();
export const stringRecordSchema = z.record(z.string(), z.string());
export const unknownRecordSchema = z.record(z.string(), z.unknown());
