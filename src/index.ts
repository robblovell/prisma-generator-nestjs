import fs from 'node:fs/promises';
import path from 'node:path';
import makeDir from 'make-dir';
import { generatorHandler } from '@prisma/generator-helper';
import { parseEnvValue, logger } from '@prisma/internals';
import prettier from 'prettier';

import { run } from './generator';

import type { GeneratorOptions } from '@prisma/generator-helper';
import type { WriteableFileSpecs, NamingStyle } from './generator/types';

export const stringToBoolean = (input: string, defaultValue = false) => {
  if (input === 'true') {
    return true;
  }
  if (input === 'false') {
    return false;
  }

  return defaultValue;
};

export const generate = async (options: GeneratorOptions) => {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const output = parseEnvValue(options.generator.output!);

  const {
    connectDtoPrefix = '',
    connectDtoPostfix = 'Connect',
    createDtoPrefix = '',
    createDtoPostfix = 'Create',
    updateDtoPrefix = '',
    updateDtoPostfix = 'Update',
    dtoSuffix = 'Dto',
    entityPrefix = '',
    entityPostfix = '',
    entitySuffix = '',
    fileNamingStyle = 'camel',
    outputType = 'class',
    connectNamePrefix = '',
    connectNamePostfix = '',
    createNamePrefix = '',
    createNamePostfix = '',
    updateNamePrefix = '',
    updateNamePostfix = '',
  } = options.generator.config;

  const exportRelationModifierClasses = stringToBoolean(
    options.generator.config.exportRelationModifierClasses,
    true,
  );

  const outputToNestJsResourceStructure = stringToBoolean(
    options.generator.config.outputToNestJsResourceStructure,
    // using `true` as default value would be a breaking change
    false,
  );

  const flatResourceStructure = stringToBoolean(
    options.generator.config.flatResourceStructure,
    // using `true` as default value would be a breaking change
    false,
  );

  const reExport = stringToBoolean(
    options.generator.config.reExport,
    // using `true` as default value would be a breaking change
    false,
  );

  const supportedFileNamingStyles = ['kebab', 'camel', 'pascal', 'snake'];
  const isSupportedFileNamingStyle = (style: string): style is NamingStyle =>
    supportedFileNamingStyles.includes(style);

  if (!isSupportedFileNamingStyle(fileNamingStyle)) {
    throw new Error(
      `'${fileNamingStyle}' is not a valid file naming style. Valid options are ${supportedFileNamingStyles
        .map((s) => `'${s}'`)
        .join(', ')}.`,
    );
  }

  const classValidation = stringToBoolean(
    options.generator.config.classValidation,
    // using `true` as default value would be a breaking change
    false,
  );

  const supportedOutputTypes = ['class', 'interface'];
  if (!supportedOutputTypes.includes(outputType)) {
    throw new Error(
      `'${outputType}' is not a valid output type. Valid options are 'class' and 'interface'.`,
    );
  }

  const noDependencies = stringToBoolean(
    options.generator.config.noDependencies,
    // using `true` as default value would be a breaking change
    false,
  );

  if (classValidation && outputType !== 'class') {
    throw new Error(
      `To use 'validation' validation decorators, 'outputType' must be 'class'.`,
    );
  }

  if (classValidation && noDependencies) {
    throw new Error(
      `To use 'validation' validation decorators, 'noDependencies' cannot be false.`,
    );
  }

  const results = run({
    output,
    dmmf: options.dmmf,
    exportRelationModifierClasses,
    outputToNestJsResourceStructure,
    flatResourceStructure,
    connectNamePrefix,
    connectNamePostfix,
    createNamePrefix,
    createNamePostfix,
    updateNamePrefix,
    updateNamePostfix,
    connectDtoPrefix,
    connectDtoPostfix,
    createDtoPrefix,
    createDtoPostfix,
    updateDtoPrefix,
    updateDtoPostfix,
    dtoSuffix,
    entityPrefix,
    entityPostfix,
    entitySuffix,
    fileNamingStyle,
    classValidation,
    outputType,
    noDependencies,
  });

  const indexCollections: Record<string, WriteableFileSpecs> = {};

  if (reExport) {
    results.forEach(({ fileName }) => {
      const dirName = path.dirname(fileName);

      const { [dirName]: fileSpec } = indexCollections;
      indexCollections[dirName] = {
        fileName: fileSpec?.fileName || path.join(dirName, 'index.ts'),
        content: [
          fileSpec?.content || '',
          `export * from './${path.basename(fileName, '.ts')}';`,
        ].join('\n'),
      };
    });
  }

  const applyPrettier = stringToBoolean(
    options.generator.config.prettier,
    false,
  );

  let prettierConfig: prettier.Options = {};
  if (applyPrettier) {
    const prettierConfigFile = await prettier.resolveConfigFile(process.cwd());
    if (!prettierConfigFile) {
      logger.info('Stylizing output DTOs with the default Prettier config.');
    } else {
      logger.info(
        `Stylizing output DTOs with found Prettier config. (${prettierConfigFile})`,
      );
    }

    if (prettierConfigFile) {
      const resolvedConfig = await prettier.resolveConfig(prettierConfigFile, {
        config: prettierConfigFile,
      });

      if (resolvedConfig) prettierConfig = resolvedConfig;
    }

    // Ensures that there are no parsing issues
    // We know that the output files are always Typescript
    prettierConfig.parser = 'typescript';
  }

  return Promise.all(
    results
      .concat(Object.values(indexCollections))
      .map(async ({ fileName, content }) => {
        await makeDir(path.dirname(fileName));

        if (applyPrettier) content = prettier.format(content, prettierConfig);

        return fs.writeFile(fileName, content);
      }),
  );
};

generatorHandler({
  onManifest: () => ({
    defaultOutput: '../src/generated/nestjs-dto',
    prettyName: 'NestJS DTO Generator',
  }),
  onGenerate: generate,
});
