import { config } from '../../config';
import { MetadataManager } from './metadata-manager';
import type { RegistryType, PackageSource } from '../../types';

class MetadataIndex extends MetadataManager {
  addVersion(
    packageId: number,
    version: string,
    size: number,
    filePath: string,
    sha1?: string,
    isDownload: boolean = false
  ): void {
    this.registerVersion(packageId, version, size, filePath, sha1, isDownload);
  }

  incrementVersionDownload(packageId: number, version: string): void {
    this.recordDownload(packageId, version);
  }
}

let metadataInstance: MetadataIndex | null = null;

export function getMetadataIndex(): MetadataIndex {
  if (!metadataInstance) {
    metadataInstance = new MetadataIndex(config.dataDir);
  }
  return metadataInstance;
}

export { MetadataManager } from './metadata-manager';
export { MetadataStore } from './metadata-store';
