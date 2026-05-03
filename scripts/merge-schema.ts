import * as fs from 'fs/promises';
import * as path from 'path';

interface MergeSchemaOptions {
  schemasDir?: string;
  mainSchemaPath?: string;
  createBackup?: boolean;
  backupDir?: string;
  validateSchema?: boolean;
  dryRun?: boolean;
}

interface MergeResult {
  success: boolean;
  filesProcessed: number;
  totalSize: number;
  backupPath?: string;
  errors: string[];
  warnings: string[];
}

/**
 * Validates that a directory exists and is readable
 */
async function validateDirectory(dirPath: string, name: string): Promise<void> {
  try {
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error(`${name} path is not a directory: ${dirPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${name} directory does not exist: ${dirPath}`);
    }
    throw new Error(`Cannot access ${name} directory: ${dirPath}`);
  }
}

/**
 * Creates a backup of the main schema file
 */
async function createBackup(
  mainSchemaPath: string,
  backupDir: string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `schema-backup-${timestamp}.prisma`;
  const backupPath = path.join(backupDir, fileName);

  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(mainSchemaPath, backupPath);
    return backupPath;
  } catch (error) {
    throw new Error(`Failed to create backup: ${(error as Error).message}`);
  }
}

/**
 * Validates Prisma schema using Prisma CLI commands
 */
async function validatePrismaSchema(
  schemaPath: string,
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    const { execSync } = require('child_process');

    // First, try to format the schema to catch basic syntax issues
    try {
      execSync(`pnpx prisma format --schema="${schemaPath}"`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    } catch (formatError) {
      const errorMessage = (formatError as Error).message;
      // Don't fail on formatting errors, just warn
      console.log(`⚠️  Schema formatting warning: ${errorMessage}`);
    }

    // Then validate the schema for more comprehensive checks
    try {
      execSync(`pnpx prisma validate --schema="${schemaPath}"`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    } catch (validateError) {
      const errorMessage = (validateError as Error).message;

      // Check if it's just a missing DATABASE_URL (common in development)
      if (
        errorMessage.includes('DATABASE_URL') ||
        errorMessage.includes('Environment variable not found')
      ) {
        console.log(
          `ℹ️  Schema validation skipped: DATABASE_URL not set (this is normal in development)`,
        );
        return { isValid: true, errors: [] };
      }

      errors.push(`Schema validation failed: ${errorMessage}`);
    }
  } catch (error) {
    errors.push(
      `Failed to run Prisma CLI validation: ${(error as Error).message}`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Reads and processes schema files with error handling
 */
async function processSchemaFiles(schemasDir: string): Promise<{
  files: string[];
  contents: Map<string, string>;
  errors: string[];
}> {
  const files: string[] = [];
  const contents = new Map<string, string>();
  const errors: string[] = [];

  try {
    const allFiles = await fs.readdir(schemasDir);
    const schemaFiles = allFiles
      .filter((file) => file.endsWith('.prisma'))
      .sort();

    for (const file of schemaFiles) {
      try {
        const filePath = path.join(schemasDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        if (!content.trim()) {
          errors.push(`Warning: ${file} is empty`);
        }

        files.push(file);
        contents.set(file, content);
      } catch (error) {
        errors.push(`Failed to read ${file}: ${(error as Error).message}`);
      }
    }
  } catch (error) {
    errors.push(
      `Failed to read schemas directory: ${(error as Error).message}`,
    );
  }

  return { files, contents, errors };
}

/**
 * Merges all schema files from the schemas folder into the main schema.prisma file
 */
export async function mergeSchema(
  options: MergeSchemaOptions = {},
): Promise<MergeResult> {
  const {
    schemasDir = path.join(__dirname, '../prisma/schemas'),
    mainSchemaPath = path.join(__dirname, '../prisma/schema.prisma'),
    createBackup: shouldCreateBackup = true,
    backupDir = path.join(__dirname, '../backups'),
    validateSchema = true,
    dryRun = false,
  } = options;

  const result: MergeResult = {
    success: false,
    filesProcessed: 0,
    totalSize: 0,
    errors: [],
    warnings: [],
  };

  try {
    // Validate directories
    await validateDirectory(schemasDir, 'Schemas');
    await validateDirectory(path.dirname(mainSchemaPath), 'Main schema');

    // Static content from the main file
    const mainSchemaContent = `// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

// Looking for ways to speed up your queries, or scale easily with your serverless or edge functions?
// Try Prisma Accelerate: https://pris.ly/cli/accelerate-init

generator client {
  provider = "prisma-client"
  output   = "../src/prisma/generated"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}`;

    // Process schema files
    const { files, contents, errors } = await processSchemaFiles(schemasDir);
    result.errors.push(...errors);

    if (files.length === 0) {
      result.errors.push('No schema files found to merge');
      return result;
    }

    // Create backup if requested
    let backupPath: string | undefined;
    if (shouldCreateBackup && !dryRun) {
      try {
        backupPath = await createBackup(mainSchemaPath, backupDir);
        result.backupPath = backupPath;
      } catch (error) {
        result.warnings.push(
          `Failed to create backup: ${(error as Error).message}`,
        );
      }
    }

    // Build merged content
    const schemaContents: string[] = [];

    for (const file of files) {
      const content = contents.get(file);
      if (!content) {
        result.errors.push(`Content not found for file: ${file}`);
        continue;
      }
      schemaContents.push(`\n// === ${file} ===`);
      schemaContents.push(content);
    }

    const mergedContent = mainSchemaContent + '\n' + schemaContents.join('\n');

    // Validate merged schema if requested
    if (validateSchema) {
      // Create a temporary file for validation
      const tempSchemaPath = path.join(
        path.dirname(mainSchemaPath),
        'temp-schema.prisma',
      );

      try {
        // Write merged content to temporary file
        await fs.writeFile(tempSchemaPath, mergedContent, 'utf-8');

        // Validate the temporary file
        const validation = await validatePrismaSchema(tempSchemaPath);

        if (!validation.isValid) {
          result.errors.push(...validation.errors);
          if (!dryRun) {
            throw new Error('Schema validation failed');
          }
        }
      } finally {
        // Clean up temporary file
        try {
          await fs.unlink(tempSchemaPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
          console.log(
            `Note: Could not clean up temporary file: ${tempSchemaPath}`,
          );
        }
      }
    }

    // Write merged content to main schema file (unless dry run)
    if (!dryRun) {
      await fs.writeFile(mainSchemaPath, mergedContent, 'utf-8');
    }

    // Update result
    result.success = true;
    result.filesProcessed = files.length;
    result.totalSize = mergedContent.length;

    // Log results
    console.log(`Found ${files.length} schema files to merge:`);
    files.forEach((file) => console.log(`  - ${file}`));

    if (backupPath) {
      console.log(`\n📦 Backup created: ${backupPath}`);
    }

    if (dryRun) {
      console.log('\n🔍 Dry run completed - no files were modified');
    } else {
      console.log(
        `\n✅ Successfully merged ${files.length} schema files into ${mainSchemaPath}`,
      );
    }

    console.log(`Total schema size: ${mergedContent.length} characters`);

    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.forEach((warning) => console.log(`  - ${warning}`));
    }
  } catch (error) {
    result.errors.push((error as Error).message);
    console.error('❌ Error merging schemas:', error);
  }

  return result;
}

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: MergeSchemaOptions = {};

  // Parse command line arguments
  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-backup') {
      options.createBackup = false;
    } else if (arg === '--no-validate') {
      options.validateSchema = false;
    } else if (arg.startsWith('--backup-dir=')) {
      options.backupDir = arg.split('=')[1];
    }
  }

  try {
    const result = await mergeSchema(options);

    if (!result.success) {
      console.error('\n❌ Merge failed with errors:');
      result.errors.forEach((error) => console.error(`  - ${error}`));
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Run the merge if this script is executed directly
if (require.main === module) {
  main();
}
