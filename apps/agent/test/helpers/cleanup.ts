import fs from "node:fs/promises";

const retryableCleanupErrorCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

export const removeDirectoryWithRetries = async (
  directoryPath: string,
  maxAttempts = 10,
  delayMs = 50,
) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fs.rm(directoryPath, {
        recursive: true,
        force: true,
      });
      return;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (!errorCode || !retryableCleanupErrorCodes.has(errorCode) || attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, delayMs * attempt);
      });
    }
  }
};
