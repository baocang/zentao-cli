import { brandText } from '../brand.js';
import { realpathSync } from 'node:fs';
import { Command } from 'commander';
import { getCliVersion } from '../utils/version.js';
import { emitResult } from '../utils/output.js';
import packageInfo from '../../package.json';
export function registerVersionCommand(program: Command): void {
    program.command('version').description('离线显示 CLI、SDK 和运行时版本').action((_opts, cmd: Command) => {
        emitResult({
            cli: getCliVersion(),
            package: packageInfo.name,
            path: realpathSync(process.argv[1] ?? process.cwd()),
            sdk: packageInfo.dependencies['zentao-api'],
            runtime: typeof Bun === 'undefined' ? `Node ${process.versions.node}` : `Bun ${Bun.version}`, platform: process.platform, arch: process.arch }, cmd.optsWithGlobals());
    });
}
