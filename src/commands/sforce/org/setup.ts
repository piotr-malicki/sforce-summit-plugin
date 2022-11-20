import { flags, SfdxCommand } from '@salesforce/command';
import { AnyJson } from '@salesforce/ts-types';
import { ScratchOrgRequest } from '@salesforce/core';
import { readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { ComponentSet } from '@salesforce/source-deploy-retrieve';

export default class Setup extends SfdxCommand {
  public static description = 'set up new org';
  public static examples = [
    `sfdx <%= command.id %>`,
    `sfdx <%= command.id %> -a my-new-org -m force-app -c config/project-scratch-def.json -v DevHub`
  ];

  protected static flagsConfig = {
    alias: flags.string({
      char: 'a',
      description: 'scratch org alias'
    }),
    configfile: flags.directory({
      char: 'c',
      description: 'path to scratch org configuration',
      default: 'config/project-scratch-def.json',
      required: true
    }),
    defautl: flags.boolean({
      char: 'd',
      description: 'set an org as default'
    }),
    metadata: flags.directory({
      char: 'm',
      description: 'metadata directory',
      default: 'force-app',
      required: true
    })
  };

  protected static supportsDevhubUsername = true;
  protected static requiresProject = true;
  protected static requiresUsername = false;

  public async run(): Promise<AnyJson> {
    const scratchOrgResult = await this.createScratchOrg();
    this.installPackages(scratchOrgResult.username);
    await this.deployMetadata(scratchOrgResult.username);

    this.ux.log(scratchOrgResult.authInfo.getOrgFrontDoorUrl());

    return {
      username: scratchOrgResult.username
    };
  }

  async createScratchOrg() {
    const options: ScratchOrgRequest = {
      alias: this.flags.alias,
      setDefault: this.flags.default,
      orgConfig: await this.getOrgConfiguration()
    };

    this.ux.startSpinner(`Creating new scratch org (alias: ${this.flags.alias})`);
    const scratchOrgResult = await this.hubOrg.scratchOrgCreate(options);
    this.ux.stopSpinner(`scratch org successfully created (username: ${scratchOrgResult.username})`);

    return scratchOrgResult;
  }

  async getOrgConfiguration() {
    const configFile = await readFile(this.flags.configfile, 'utf-8');
    return JSON.parse(configFile);
  }

  installPackages(username) {
    const packageEntries = Object.entries(this.project.getSfProjectJson().getPackageAliases());
    for (const [pkgAlias, pkgId ] of packageEntries) {
      this.ux.startSpinner(`Installing ${pkgAlias} package...`);
      execSync(`sfdx force:package:install -p ${pkgId} -u ${username}`);
      this.ux.stopSpinner();
    }
  }

  async deployMetadata(username) {
    this.ux.startSpinner('Deploying metadata');
    const deploy = await ComponentSet.fromSource(this.flags.metadata).deploy({ usernameOrConnection: username });

    deploy.onUpdate(response => {
      const { status, numberComponentsDeployed, numberComponentsTotal } = response;
      const progress = `${numberComponentsDeployed}/${numberComponentsTotal}`;
      this.ux.log(`Status: ${status}. Progress: ${progress}`)
    });

    const result = await deploy.pollStatus();
    this.ux.stopSpinner(`finished with ${result.response.status} status`);
  }
}
