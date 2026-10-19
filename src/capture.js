'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { Monitor } = require('node-screenshots');

function listMonitors() {
  return Monitor.all().map((monitor, index) => ({
    index,
    id: monitor.id(),
    name: monitor.name(),
    primary: monitor.isPrimary(),
    scaleFactor: monitor.scaleFactor(),
    rotation: monitor.rotation(),
    bounds: {
      x: monitor.x(),
      y: monitor.y(),
      width: monitor.width(),
      height: monitor.height()
    },
    _monitor: monitor
  }));
}

function virtualScreenOf(monitors) {
  const x1 = Math.min(...monitors.map((m) => m.bounds.x));
  const y1 = Math.min(...monitors.map((m) => m.bounds.y));
  const x2 = Math.max(...monitors.map((m) => m.bounds.x + m.bounds.width));
  const y2 = Math.max(...monitors.map((m) => m.bounds.y + m.bounds.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function intersect(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function clampRegion(region, virtualScreen) {
  const clipped = intersect(region, virtualScreen);
  if (!clipped) {
    throw new Error(
      `region ${region.width}x${region.height} at ${region.x},${region.y} is outside the screen ` +
        `(${virtualScreen.width}x${virtualScreen.height} at ${virtualScreen.x},${virtualScreen.y})`
    );
  }
  return clipped;
}

function resolveRegion(monitors, options) {
  const virtualScreen = virtualScreenOf(monitors);

  if (options.region) {
    const r = options.region;
    const width = Math.round(Number(r.width));
    const height = Math.round(Number(r.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('region.width and region.height must be positive numbers');
    }
    return clampRegion(
      { x: Math.round(Number(r.x) || 0), y: Math.round(Number(r.y) || 0), width, height },
      virtualScreen
    );
  }

  if (options.display !== undefined && options.display !== null) {
    const index = Math.round(Number(options.display));
    const monitor = monitors[index];
    if (!monitor) {
      throw new Error(
        `display ${options.display} not found; ${monitors.length} display(s) available (0-${monitors.length - 1})`
      );
    }
    return { ...monitor.bounds };
  }

  return virtualScreen;
}

async function getScreenSize() {
  const monitors = listMonitors();
  if (!monitors.length) throw new Error('no displays detected');
  return {
    platform: process.platform,
    virtualScreen: virtualScreenOf(monitors),
    displays: monitors.map(({ _monitor, ...rest }) => rest)
  };
}

/**
 * Capture the screen (or a region of it) and return an encoded image.
 * Regions spanning several monitors are stitched together.
 */
async function captureScreenshot(options = {}) {
  const format = options.format === 'jpeg' || options.format === 'jpg' ? 'jpeg' : 'png';
  const quality = Math.min(100, Math.max(1, Math.round(Number(options.quality)) || 90));

  const monitors = listMonitors();
  if (!monitors.length) throw new Error('no displays detected');

  const region = resolveRegion(monitors, options);
  const parts = [];

  for (const monitor of monitors) {
    const overlap = intersect(region, monitor.bounds);
    if (!overlap) continue;

    const image = await monitor._monitor.captureImage();
    const cropped = await image.crop(
      overlap.x - monitor.bounds.x,
      overlap.y - monitor.bounds.y,
      overlap.width,
      overlap.height
    );
    parts.push({
      input: await cropped.toPng(),
      left: overlap.x - region.x,
      top: overlap.y - region.y
    });
  }

  if (!parts.length) throw new Error('nothing to capture in the requested region');

  let pipeline;
  if (parts.length === 1 && parts[0].left === 0 && parts[0].top === 0) {
    pipeline = sharp(parts[0].input);
  } else {
    pipeline = sharp({
      create: {
        width: region.width,
        height: region.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 }
      }
    }).composite(parts.map((p) => ({ input: p.input, left: p.left, top: p.top })));
  }

  const buffer =
    format === 'jpeg'
      ? await pipeline.flatten({ background: '#000' }).jpeg({ quality }).toBuffer()
      : await pipeline.png().toBuffer();

  let savedPath = null;
  if (options.savePath) {
    savedPath = path.resolve(String(options.savePath));
    await fsp.mkdir(path.dirname(savedPath), { recursive: true });
    await fsp.writeFile(savedPath, buffer);
  }

  return {
    buffer,
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    meta: {
      platform: process.platform,
      format,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: region.width,
      height: region.height,
      region,
      virtualScreen: virtualScreenOf(monitors),
      bytes: buffer.length,
      path: savedPath
    }
  };
}

module.exports = { getScreenSize, captureScreenshot, resolveRegion, clampRegion };
