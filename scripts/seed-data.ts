import { PrismaClient, UserRole } from '../src/prisma/generated/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

interface User {
  name: string;
  email: string;
  role: UserRole;
  balance: number;
  password: string;
}

interface SeedResult {
  success: boolean;
  users_created: number;
  errors: string[];
  warnings: string[];
}

class DbSeeder {
  /**
   * Constructor
   * @param prisma
   * @param result
   */
  constructor(
    private readonly prisma: PrismaClient,
    private result: SeedResult,
  ) {}

  /**
   * Load JSON data from file.
   */
  private async loadJSONData<T>(file_path: string): Promise<T[]> {
    try {
      const data = await fs.readFile(path.join(__dirname, file_path), 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error(
        `Failed to load data from ${file_path}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Seed the user records
   */
  private async seedUser(): Promise<void> {
    console.log('Seeding the user database...');

    const users = await this.loadJSONData<User>('../data/users.json');

    for (const user of users) {
      try {
        const salt = await bcrypt.genSalt(10);
        const password = await bcrypt.hash(user.password, salt);

        await this.prisma.user.upsert({
          where: { email: user.email },
          update: { ...user },
          create: { ...user, password },
        });
        this.result.users_created++;
      } catch (error) {
        this.result.errors.push(`Failed to seed user record.`);
      }
    }

    console.log(`Created/Updated ${this.result.users_created} user records.`);
  }

  private async validateData(): Promise<void> {
    console.log('Validating data integrity...');

    const users = await this.prisma.user.count();

    console.log(`📊 Data Summary:`);
    console.log(`📊 users: ${users}`);
  }

  async seed(): Promise<SeedResult> {
    console.log('Starting data seeding...');

    try {
      const data_files = ['../data/users.json'];

      for (const file of data_files) {
        try {
          await fs.access(path.join(__dirname, file));
        } catch (error) {
          this.result.errors.push(`${file} is not found.`);
        }
      }

      if (this.result.errors.length > 0) {
        throw new Error('Required data files are missing.');
      }

      // Seed data
      await this.seedUser();

      await this.validateData();

      this.result.success = true;

      console.log('\n🎉 Data seeding completed successfully!');
    } catch (error) {
      this.result.errors.push(`Seeding failed: ${(error as Error).message}`);
      console.error('❌ Seeding failed:', error);
    } finally {
      await this.prisma.$disconnect();
    }

    return this.result;
  }

  /**
   * Clean up existing data (use with caution)
   */
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up existing db data...');

    try {
      await this.prisma.user.deleteMany();

      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      throw error;
    }
  }
}

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    }),
  });

  const seedResult: SeedResult = {
    users_created: 0,
    warnings: [],
    errors: [],
    success: false,
  };

  const seeder = new DbSeeder(prisma, seedResult);

  try {
    if (args.includes('--cleanup')) {
      await seeder.cleanup();
    }

    const result = await seeder.seed();

    if (!result.success) {
      console.error('\n❌ Seeding failed with errors:');
      result.errors.forEach((error) => console.error(`  - ${error}`));
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.forEach((warning) => console.log(`  - ${warning}`));
    }

    console.log('\n📈 Final Results:');
    console.log(`📊 users: ${result.users_created}`);
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Run the seeder if this script is executed directly
if (require.main === module) {
  main();
}

export { DbSeeder };
