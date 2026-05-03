export interface RequestMetadata {
  ip: string;
  raw: string;
  browser: {
    name?: string;
    version?: string;
    major?: string;
    type?: string;
  };
  device: {
    type?: string;
    model?: string;
    vendor?: string;
  };
  os: {
    name?: string;
    version?: string;
  };
}
