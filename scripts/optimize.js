import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import imagemin from 'imagemin';
import imageminPngquant from 'imagemin-pngquant';
import imageminMozjpeg from 'imagemin-mozjpeg';
import imageminSvgo from 'imagemin-svgo';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const config = {
    images: {
        quality: 80,
        maxWidth: 1920,
        formats: ['jpg', 'jpeg', 'png', 'webp']
    },
    compression: {
        level: 9
    }
};

// Optimize images
async function optimizeImages() {
    const imageDir = path.join(__dirname, '..', 'public', 'images');
    const files = await fs.readdir(imageDir);

    for (const file of files) {
        const ext = path.extname(file).toLowerCase().slice(1);
        if (!config.images.formats.includes(ext)) continue;

        const inputPath = path.join(imageDir, file);
        const outputPath = path.join(imageDir, `optimized-${file}`);

        try {
            // Resize and compress image
            await sharp(inputPath)
                .resize(config.images.maxWidth, null, {
                    withoutEnlargement: true,
                    fit: 'inside'
                })
                .toFormat(ext, { quality: config.images.quality })
                .toFile(outputPath);

            // Replace original with optimized version
            await fs.unlink(inputPath);
            await fs.rename(outputPath, inputPath);

            console.log(`Optimized: ${file}`);
        } catch (error) {
            console.error(`Error optimizing ${file}:`, error);
        }
    }
}

// Compress static files
async function compressStaticFiles() {
    const staticDir = path.join(__dirname, '..', 'public');
    const files = await fs.readdir(staticDir);

    for (const file of files) {
        if (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js')) {
            const filePath = path.join(staticDir, file);
            const content = await fs.readFile(filePath, 'utf8');
            
            try {
                const compressed = await gzipAsync(content, { level: config.compression.level });
                await fs.writeFile(`${filePath}.gz`, compressed);
                console.log(`Compressed: ${file}`);
            } catch (error) {
                console.error(`Error compressing ${file}:`, error);
            }
        }
    }
}

// Main optimization function
async function optimize() {
    console.log('Starting optimization...');

    try {
        // Optimize images
        console.log('Optimizing images...');
        await optimizeImages();

        // Compress static files
        console.log('Compressing static files...');
        await compressStaticFiles();

        console.log('Optimization complete!');
    } catch (error) {
        console.error('Optimization failed:', error);
        process.exit(1);
    }
}

// Run optimization
optimize(); 