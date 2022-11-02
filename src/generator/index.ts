import path from 'node:path';
import { camel, pascal, kebab, snake } from 'case';
import { logger } from '@prisma/internals';
import { makeHelpers } from './template-helpers';
import { computeModelParams } from './compute-model-params';
import { computeTypeParams } from './compute-type-params';
import { generateConnectDto } from './generate-connect-dto';
import { generateCreateDto } from './generate-create-dto';
import { generateUpdateDto } from './generate-update-dto';
import { generateEntity } from './generate-entity';
import { generatePlainDto } from './generate-plain-dto';
import { DTO_IGNORE_MODEL } from './annotations';
import { isAnnotatedWith } from './field-classifiers';

import type { DMMF } from '@prisma/generator-helper';
import { NamingStyle, Model, WriteableFileSpecs } from './types';

interface RunParam {
  output: string;
  dmmf: DMMF.Document;
  exportRelationModifierClasses: boolean;
  outputToNestJsResourceStructure: boolean;
  flatResourceStructure: boolean;
  connectDtoPrefix: string;
  connectDtoPostfix: string;
  createDtoPrefix: string;
  createDtoPostfix: string;
  updateDtoPrefix: string;
  updateDtoPostfix: string;
  dtoSuffix: string;
  entityPrefix: string;
  entityPostfix: string;
  entitySuffix: string;
  createNamePrefix: string;
  createNamePostfix: string;
  updateNamePrefix: string;
  updateNamePostfix: string;
  connectNamePrefix: string;
  connectNamePostfix: string;
  fileNamingStyle: NamingStyle;
  classValidation: boolean;
  outputType: string;
  noDependencies: boolean;
}

export const run = ({
  output,
  dmmf,
  ...options
}: RunParam): WriteableFileSpecs[] => {
  const {
    exportRelationModifierClasses,
    outputToNestJsResourceStructure,
    flatResourceStructure,
    fileNamingStyle = 'camel',
    classValidation,
    outputType,
    noDependencies,
    createNamePrefix,
    createNamePostfix,
    updateNamePrefix,
    updateNamePostfix,
    connectNamePrefix,
    connectNamePostfix,
    ...preAndSuffixes
  } = options;

  const transformers: Record<NamingStyle, (str: string) => string> = {
    camel,
    kebab,
    pascal,
    snake,
  };

  const transformFileNameCase = transformers[fileNamingStyle];

  const templateHelpers = makeHelpers({
    transformFileNameCase,
    transformClassNameCase: pascal,
    classValidation,
    outputType,
    noDependencies,
    createNamePrefix,
    createNamePostfix,
    updateNamePrefix,
    updateNamePostfix,
    connectNamePrefix,
    connectNamePostfix,
    ...preAndSuffixes,
  });
  const allModels = dmmf.datamodel.models;

  const filteredTypes: Model[] = dmmf.datamodel.types
    .filter((model) => !isAnnotatedWith(model, DTO_IGNORE_MODEL))
    .map((model) => ({
      ...model,
      output: {
        dto: outputToNestJsResourceStructure
          ? flatResourceStructure
            ? path.join(output, transformFileNameCase(model.name))
            : path.join(output, transformFileNameCase(model.name), 'dto')
          : output,
        entity: '',
      },
    }));

  const filteredModels: Model[] = allModels
    .filter((model) => !isAnnotatedWith(model, DTO_IGNORE_MODEL))
    // adds `output` information for each model, so we can compute relative import paths
    // this assumes that NestJS resource modules (more specifically their folders on disk) are named as `transformFileNameCase(model.name)`
    .map((model) => ({
      ...model,
      type: 'model',
      output: {
        dto: outputToNestJsResourceStructure
          ? flatResourceStructure
            ? path.join(output, transformFileNameCase(model.name))
            : path.join(output, transformFileNameCase(model.name), 'dto')
          : output,
        entity: outputToNestJsResourceStructure
          ? flatResourceStructure
            ? path.join(output, transformFileNameCase(model.name))
            : path.join(output, transformFileNameCase(model.name), 'entities')
          : output,
      },
    }));

  const typeFiles = filteredTypes.map((model) => {
    logger.info(`Processing Type ${model.name}`);

    const typeParams = computeTypeParams({
      model,
      allModels: filteredTypes,
      templateHelpers,
      connectNamePrefix,
      connectNamePostfix,
      createNamePrefix,
      createNamePostfix,
      updateNamePrefix,
      updateNamePostfix,
    });

    // generate create-model.dto.ts
    const createDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.createDtoFilename(
          model.name,
          createNamePrefix,
          createNamePostfix,
          true,
        ),
      ),
      content: generateCreateDto({
        ...typeParams.create,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };

    // generate update-model.dto.ts
    const updateDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.updateDtoFilename(
          model.name,
          updateNamePrefix,
          updateNamePostfix,
          true,
        ),
      ),
      content: generateUpdateDto({
        ...typeParams.update,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };

    // generate model.dto.ts
    const plainDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.plainDtoFilename(model.name, true),
      ),
      content: generatePlainDto({
        ...typeParams.plain,
        templateHelpers,
      }),
    };

    return [createDto, updateDto, plainDto];
  });

  const modelFiles = filteredModels.map((model) => {
    logger.info(`Processing Model ${model.name}`);

    const modelParams = computeModelParams({
      model,
      allModels: [...filteredTypes, ...filteredModels],
      connectNamePrefix,
      connectNamePostfix,
      createNamePrefix,
      createNamePostfix,
      updateNamePrefix,
      updateNamePostfix,
      templateHelpers,
    });

    // generate connect-model.dto.ts
    const connectDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.connectDtoFilename(
          model.name,
          connectNamePrefix,
          connectNamePostfix,
          true,
        ),
      ),
      content: generateConnectDto({
        ...modelParams.connect,
        templateHelpers,
      }),
    };

    // generate create-model.dto.ts
    const createDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.createDtoFilename(
          model.name,
          createNamePrefix,
          createNamePostfix,
          true,
        ),
      ),
      content: generateCreateDto({
        ...modelParams.create,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };
    // TODO generate create-model.struct.ts

    // generate update-model.dto.ts
    const updateDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.updateDtoFilename(
          model.name,
          updateNamePrefix,
          updateNamePostfix,
          true,
        ),
      ),
      content: generateUpdateDto({
        ...modelParams.update,
        exportRelationModifierClasses,
        templateHelpers,
      }),
    };
    // TODO generate update-model.struct.ts

    // generate model.entity.ts
    const entity = {
      fileName: path.join(
        model.output.entity,
        templateHelpers.entityFilename(model.name, true),
      ),
      content: generateEntity({
        ...modelParams.entity,
        templateHelpers,
      }),
    };
    // TODO generate model.struct.ts

    // generate model.dto.ts
    const plainDto = {
      fileName: path.join(
        model.output.dto,
        templateHelpers.plainDtoFilename(model.name, true),
      ),
      content: generatePlainDto({
        ...modelParams.plain,
        templateHelpers,
      }),
    };

    return [connectDto, createDto, updateDto, entity, plainDto];
  });

  return [...typeFiles, ...modelFiles].flat();
};
