import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import logger from './monitoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// Ensure backup directory exists
await fs.mkdir(BACKUP_DIR, { recursive: true });

export const createBackup = async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.sqlite`);
    
    try {
        // Copy database file
        await fs.copyFile(config.db.path, backupPath);
        
        // Compress backup
        const compressedPath = `${backupPath}.gz`;
        const fileContent = await fs.readFile(backupPath);
        const compressed = await gzip(fileContent);
        await fs.writeFile(compressedPath, compressed);
        
        // Remove uncompressed backup
        await fs.unlink(backupPath);
        
        logger.info(`Backup created: ${compressedPath}`);
        return compressedPath;
    } catch (error) {
        logger.error('Backup failed:', error);
        throw error;
    }
};

export const restoreBackup = async (backupPath) => {
    try {
        // Decompress backup
        const compressed = await fs.readFile(backupPath);
        const decompressed = await gunzip(compressed);
        
        // Restore database
        await fs.writeFile(config.db.path, decompressed);
        
        logger.info(`Backup restored from: ${backupPath}`);
    } catch (error) {
        logger.error('Restore failed:', error);
        throw error;
    }
};

export const listBackups = async () => {
    try {
        const files = await fs.readdir(BACKUP_DIR);
        return files
            .filter(file => file.endsWith('.gz'))
            .map(file => ({
                name: file,
                path: path.join(BACKUP_DIR, file),
                size: fs.stat(path.join(BACKUP_DIR, file)).then(stat => stat.size)
            }));
    } catch (error) {
        logger.error('Failed to list backups:', error);
        throw error;
    }
};

export const cleanupOldBackups = async (maxAge = 7 * 24 * 60 * 60 * 1000) => {
    try {
        const backups = await listBackups();
        const now = Date.now();
        
        for (const backup of backups) {
            const stats = await fs.stat(backup.path);
            const age = now - stats.mtime.getTime();
            
            if (age > maxAge) {
                await fs.unlink(backup.path);
                logger.info(`Deleted old backup: ${backup.name}`);
            }
        }
    } catch (error) {
        logger.error('Backup cleanup failed:', error);
        throw error;
    }
}; 