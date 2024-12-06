export const enum Capability {
  ExperimentalSnapshots = 1 << 0,
}

export class NodeVersion {
  private readonly capabilities = 0;

  public static process() {
    const version = process.versions.node.split(".").map(Number);
    return new NodeVersion(new Semver(version[0], version[1], version[2]));
  }

  constructor(public readonly semver: Semver) {
    // todo@connor4312: currently still experimental in 23, if it's extended
    // to stable 24 then then should be updated to lt(new Semver(25, 0, 0))
    if (semver.gte(new Semver(22, 3, 0)) && semver.lt(new Semver(24, 0, 0))) {
      this.capabilities |= Capability.ExperimentalSnapshots;
    }
  }

  public has(capability: Capability) {
    return (this.capabilities & capability) !== 0;
  }
}

class Semver {
  constructor(
    public readonly major: number,
    public readonly minor: number,
    public readonly patch: number,
  ) {}

  public compare(other: Semver) {
    return this.major - other.major || this.minor - other.minor || this.patch - other.patch;
  }

  public gt(other: Semver) {
    return this.compare(other) > 0;
  }

  public gte(other: Semver) {
    return this.compare(other) >= 0;
  }

  public lt(other: Semver) {
    return this.compare(other) < 0;
  }

  public lte(other: Semver) {
    return this.compare(other) <= 0;
  }
}
