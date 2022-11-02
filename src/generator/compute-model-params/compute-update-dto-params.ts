import slash from 'slash';
import path from 'node:path';
import {
  DTO_RELATION_CAN_CONNECT_ON_UPDATE,
  DTO_RELATION_CAN_CREATE_ON_UPDATE,
  DTO_RELATION_INCLUDE_ID,
  DTO_RELATION_MODIFIERS_ON_UPDATE,
  DTO_TYPE_FULL_UPDATE,
  DTO_UPDATE_OPTIONAL,
} from '../annotations';
import {
  isAnnotatedWith,
  isAnnotatedWithOneOf,
  isId,
  isReadOnly,
  isRelation,
  isRequiredWithDefaultValue,
  isType,
  isUpdatedAt,
} from '../field-classifiers';
import {
  concatIntoArray,
  concatUniqueIntoArray,
  generateRelationInput,
  getRelationScalars,
  getRelativePath,
  makeImportsFromPrismaClient,
  mapDMMFToParsedField,
  zipImportStatementParams,
} from '../helpers';

import type { DMMF } from '@prisma/generator-helper';
import type { TemplateHelpers } from '../template-helpers';
import type {
  Model,
  UpdateDtoParams,
  ImportStatementParams,
  ParsedField,
  IApiProperty,
} from '../types';
import { parseApiProperty } from '../api-decorator';
import { IClassValidator } from '../types';
import { parseClassValidators } from '../class-validator';

interface ComputeUpdateDtoParamsParam {
  model: Model;
  allModels: Model[];
  templateHelpers: TemplateHelpers;
  connectNamePrefix: string;
  connectNamePostfix: string;
  createNamePrefix: string;
  createNamePostfix: string;
  updateNamePrefix: string;
  updateNamePostfix: string;
}
export const computeUpdateDtoParams = ({
  model,
  allModels,
  templateHelpers,
  connectNamePrefix,
  connectNamePostfix,
  createNamePrefix,
  createNamePostfix,
  updateNamePrefix,
  updateNamePostfix,
}: ComputeUpdateDtoParamsParam): UpdateDtoParams => {
  let hasApiProperty = false;
  const imports: ImportStatementParams[] = [];
  const extraClasses: string[] = [];
  const apiExtraModels: string[] = [];
  const classValidators: IClassValidator[] = [];

  const relationScalarFields = getRelationScalars(model.fields);
  const relationScalarFieldNames = Object.keys(relationScalarFields);

  const fields = model.fields.reduce((result, field) => {
    const { name } = field;
    const overrides: Partial<DMMF.Field> = {
      isRequired: false,
      isNullable: !field.isRequired,
    };
    const decorators: {
      apiProperties?: IApiProperty[];
      classValidators?: IClassValidator[];
    } = {};

    if (
      isAnnotatedWith(field, DTO_RELATION_INCLUDE_ID) &&
      relationScalarFieldNames.includes(name)
    )
      field.isReadOnly = false;

    if (isReadOnly(field)) return result;
    if (isRelation(field)) {
      if (!isAnnotatedWithOneOf(field, DTO_RELATION_MODIFIERS_ON_UPDATE)) {
        return result;
      }
      const relationInputType = generateRelationInput({
        field,
        model,
        allModels,
        templateHelpers,
        preAndSuffixClassName: templateHelpers.updateDtoName,
        canCreateAnnotation: DTO_RELATION_CAN_CREATE_ON_UPDATE,
        canConnectAnnotation: DTO_RELATION_CAN_CONNECT_ON_UPDATE,
        createNamePrefix,
        createNamePostfix,
        connectNamePrefix,
        connectNamePostfix,
      });

      overrides.type = relationInputType.type;
      overrides.isList = false;
      overrides.isNullable = false;

      concatIntoArray(relationInputType.imports, imports);
      concatIntoArray(relationInputType.generatedClasses, extraClasses);
      if (!templateHelpers.config.noDependencies)
        concatIntoArray(relationInputType.apiExtraModels, apiExtraModels);
    }

    if (
      !isAnnotatedWith(field, DTO_RELATION_INCLUDE_ID) &&
      relationScalarFieldNames.includes(name)
    )
      return result;

    // fields annotated with @DtoReadOnly are filtered out before this
    // so this safely allows to mark fields that are required in Prisma Schema
    // as **not** required in UpdateDTO
    const isDtoOptional = isAnnotatedWith(field, DTO_UPDATE_OPTIONAL);
    const doFullUpdate = isAnnotatedWith(field, DTO_TYPE_FULL_UPDATE);

    if (!isDtoOptional) {
      if (isId(field)) return result;
      if (isUpdatedAt(field)) return result;
      if (isRequiredWithDefaultValue(field)) return result;
    }

    if (isType(field)) {
      // don't try to import the class we're preparing params for
      if (field.type !== model.name) {
        const modelToImportFrom = allModels.find(
          ({ name }) => name === field.type,
        );

        if (!modelToImportFrom)
          throw new Error(
            `related type '${field.type}' for '${model.name}.${field.name}' not found`,
          );

        const importName = doFullUpdate
          ? templateHelpers.createDtoName(field.type)
          : templateHelpers.updateDtoName(field.type);
        const importFrom = slash(
          `${getRelativePath(model.output.dto, modelToImportFrom.output.dto)}${
            path.sep
          }${
            doFullUpdate
              ? templateHelpers.createDtoFilename(
                  field.type,
                  createNamePrefix,
                  createNamePostfix,
                )
              : templateHelpers.updateDtoFilename(
                  field.type,
                  updateNamePrefix,
                  updateNamePostfix,
                )
          }`,
        );

        // don't double-import the same thing
        // TODO should check for match on any import name ( - no matter where from)
        if (
          !imports.some(
            (item) =>
              Array.isArray(item.destruct) &&
              item.destruct.includes(importName) &&
              item.from === importFrom,
          )
        ) {
          imports.push({
            destruct: [importName],
            from: importFrom,
          });
        }
      }
    }

    if (templateHelpers.config.classValidation) {
      decorators.classValidators = parseClassValidators(
        {
          ...field,
          ...overrides,
        },
        isType(field) && doFullUpdate
          ? templateHelpers.createDtoName
          : templateHelpers.updateDtoName,
      );
      concatUniqueIntoArray(
        decorators.classValidators,
        classValidators,
        'name',
      );
    }

    if (!templateHelpers.config.noDependencies) {
      decorators.apiProperties = parseApiProperty({
        ...field,
        ...overrides,
        isNullable: !field.isRequired,
      });
      if (decorators.apiProperties.length) hasApiProperty = true;
    }

    if (templateHelpers.config.noDependencies) {
      if (field.type === 'Json') field.type = 'Object';
      else if (field.type === 'Decimal') field.type = 'Float';
    }

    return [...result, mapDMMFToParsedField(field, overrides, decorators)];
  }, [] as ParsedField[]);

  if (apiExtraModels.length || hasApiProperty) {
    const destruct = [];
    if (apiExtraModels.length) destruct.push('ApiExtraModels');
    if (hasApiProperty) destruct.push('ApiProperty');
    imports.unshift({ from: '@nestjs/swagger', destruct });
  }

  if (classValidators.length) {
    if (classValidators.find((cv) => cv.name === 'Type')) {
      imports.unshift({
        from: 'class-transformer',
        destruct: ['Type'],
      });
    }
    imports.unshift({
      from: 'class-validator',
      destruct: classValidators
        .filter((cv) => cv.name !== 'Type')
        .map((v) => v.name)
        .sort(),
    });
  }

  const importPrismaClient = makeImportsFromPrismaClient(fields);
  if (importPrismaClient) imports.unshift(importPrismaClient);

  return {
    model,
    fields,
    imports: zipImportStatementParams(imports),
    extraClasses,
    apiExtraModels,
  };
};
