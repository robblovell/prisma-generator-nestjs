import { DMMF } from '@prisma/generator-helper';
import { ImportStatementParams, ParsedField } from './types';
import { decorateApiProperty } from './api-decorator';
import { decorateClassValidators } from './class-validator';
import { isAnnotatedWith, isType } from './field-classifiers';
import { DTO_TYPE_FULL_UPDATE } from './annotations';

const PrismaScalarToTypeScript: Record<string, string> = {
  String: 'string',
  Boolean: 'boolean',
  Int: 'number',
  // [Working with BigInt](https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields#working-with-bigint)
  BigInt: 'bigint',
  Float: 'number',
  // [Working with Decimal](https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields#working-with-decimal)
  Decimal: 'Prisma.Decimal',
  DateTime: 'Date',
  // [working with JSON fields](https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields)
  Json: 'Prisma.JsonValue',
  // [Working with Bytes](https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields#working-with-bytes)
  Bytes: 'Buffer',
  Object: '{ [key: string]: any }',
};

const knownPrismaScalarTypes = Object.keys(PrismaScalarToTypeScript);

export const scalarToTS = (scalar: string, useInputTypes = false): string => {
  if (!knownPrismaScalarTypes.includes(scalar)) {
    throw new Error(`Unrecognized scalar type: ${scalar}`);
  }

  // [Working with JSON fields](https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields)
  // supports different types for input / output. `Prisma.InputJsonValue` extends `Prisma.JsonValue` with `undefined`
  if (useInputTypes && scalar === 'Json') {
    return 'Prisma.InputJsonValue';
  }

  return PrismaScalarToTypeScript[scalar];
};

export const echo = (input: string) => input;

export const when = (condition: any, thenTemplate: string, elseTemplate = '') =>
  condition ? thenTemplate : elseTemplate;

export const unless = (
  condition: any,
  thenTemplate: string,
  elseTemplate = '',
) => (!condition ? thenTemplate : elseTemplate);

export const each = <T = any>(
  arr: Array<T>,
  fn: (item: T) => string,
  joinWith = '',
) => arr.map(fn).join(joinWith);

export const importStatement = (input: ImportStatementParams) => {
  const { from, destruct = [], default: defaultExport } = input;
  const fragments = ['import'];
  if (defaultExport) {
    if (typeof defaultExport === 'string') {
      fragments.push(defaultExport);
    } else {
      fragments.push(`* as ${defaultExport['*']}`);
    }
  }
  if (destruct.length) {
    if (defaultExport) {
      fragments.push(',');
    }
    fragments.push(
      `{${destruct.flatMap((item) => {
        if (typeof item === 'string') return item;
        return Object.entries(item).map(([key, value]) => `${key} as ${value}`);
      })}}`,
    );
  }

  fragments.push(`from '${from}'`);

  return fragments.join(' ');
};

export const importStatements = (items: ImportStatementParams[]) =>
  `${each(items, importStatement, '\n')}`;

interface MakeHelpersParam {
  connectNamePrefix: string;
  connectNamePostfix: string;
  createNamePrefix: string;
  createNamePostfix: string;
  updateNamePrefix: string;
  updateNamePostfix: string;
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
  transformClassNameCase?: (item: string) => string;
  transformFileNameCase?: (item: string) => string;
  classValidation: boolean;
  outputType: string;
  noDependencies: boolean;
}
export const makeHelpers = ({
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
  transformClassNameCase = echo,
  transformFileNameCase = echo,
  classValidation,
  outputType,
  noDependencies,
}: MakeHelpersParam) => {
  const className = (name: string, prefix = '', postfix = '', suffix = '') =>
    `${prefix}${transformClassNameCase(name)}${postfix}${suffix}`;
  const fileName = (
    name: string,
    prefix = '',
    postfix = '',
    suffix = '',
    withExtension = false,
  ) =>
    `${prefix}${transformFileNameCase(name)}${postfix}${suffix}${when(
      withExtension,
      '.ts',
    )}`;

  const entityName = (name: string) =>
    /dto$/i.test(name)
      ? className(name, '', '', '')
      : className(name, entityPrefix, entityPostfix, entitySuffix);
  const connectDtoName = (name: string) =>
    className(name, connectDtoPrefix, connectDtoPostfix, dtoSuffix);
  const createDtoName = (name: string) =>
    className(name, createDtoPrefix, createDtoPostfix, dtoSuffix);
  const updateDtoName = (name: string) =>
    className(name, updateDtoPrefix, updateDtoPostfix, dtoSuffix);
  const plainDtoName = (name: string) => className(name, '', '', dtoSuffix);
  const dtoName = (name: string, dtoType: 'create' | 'update' | 'plain') => {
    switch (dtoType) {
      case 'create':
        return createDtoName(name);
      case 'update':
        return updateDtoName(name);
      default:
        return plainDtoName(name);
    }
  };

  const connectDtoFilename = (
    name: string,
    connectNamePrefix: string,
    connectNamePostfix: string,
    withExtension = false,
  ) =>
    fileName(
      name,
      connectNamePrefix,
      connectNamePostfix,
      '.dto',
      withExtension,
    );

  const createDtoFilename = (
    name: string,
    createNamePrefix: string,
    createNamePostfix: string,
    withExtension = false,
  ) =>
    fileName(name, createNamePrefix, createNamePostfix, '.dto', withExtension);

  const updateDtoFilename = (
    name: string,
    updateNamePrefix: string,
    updateNamePostfix: string,
    withExtension = false,
  ) =>
    fileName(name, updateNamePrefix, updateNamePostfix, '.dto', withExtension);

  const entityFilename = (name: string, withExtension = false) =>
    fileName(name, undefined, '.entity', '', withExtension);

  const plainDtoFilename = (name: string, withExtension = false) =>
    fileName(name, undefined, '.dto', '', withExtension);

  const fieldType = (
    field: ParsedField,
    dtoType: 'create' | 'update' | 'plain' = 'plain',
    toInputType = false,
  ) => {
    const doFullUpdate =
      dtoType === 'update' &&
      isType(field as DMMF.Field) &&
      isAnnotatedWith(field as DMMF.Field, DTO_TYPE_FULL_UPDATE);
    return `${
      field.kind === 'scalar'
        ? scalarToTS(field.type, toInputType)
        : field.kind === 'enum' || field.kind === 'relation-input'
        ? field.type
        : field.relationName
        ? entityName(field.type)
        : dtoName(field.type, doFullUpdate ? 'create' : dtoType)
    }${when(field.isList, '[]')}`;
  };

  const fieldToDtoProp = (
    field: ParsedField,
    dtoType: 'create' | 'update' | 'plain',
    useInputTypes = false,
    forceOptional = false,
  ) =>
    `${decorateApiProperty(field)}${decorateClassValidators(field)}${
      field.name
    }${unless(field.isRequired && !forceOptional, '?', '!')}: ${fieldType(
      field,
      dtoType,
      useInputTypes,
    )} ${when(field.isNullable, ' | null')};\n\n`;

  const fieldsToDtoProps = (
    fields: ParsedField[],
    dtoType: 'create' | 'update' | 'plain',
    useInputTypes = false,
    forceOptional = false,
  ) =>
    `${each(
      fields,
      (field) => fieldToDtoProp(field, dtoType, useInputTypes, forceOptional),
      '\n\n',
    )}`;

  const fieldToEntityProp = (field: ParsedField) =>
    `${decorateApiProperty(field)}${field.name}${unless(
      field.isRequired,
      '?',
      '!',
    )}: ${fieldType(field)} ${when(field.isNullable, ' | null')};`;

  const fieldsToEntityProps = (fields: ParsedField[]) =>
    `${each(fields, (field) => fieldToEntityProp(field), '\n\n')}`;

  const apiExtraModels = (names: string[]) =>
    `@ApiExtraModels(${names.map(entityName)})`;

  return {
    config: {
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
      classValidation,
      outputType,
      noDependencies,
    },
    apiExtraModels,
    entityName,
    connectDtoName,
    createDtoName,
    updateDtoName,
    plainDtoName,
    connectDtoFilename,
    createDtoFilename,
    updateDtoFilename,
    entityFilename,
    plainDtoFilename,
    each,
    echo,
    fieldsToDtoProps,
    fieldToDtoProp,
    fieldToEntityProp,
    fieldsToEntityProps,
    fieldType,
    for: each,
    if: when,
    importStatement,
    importStatements,
    transformClassNameCase,
    transformFileNameCase,
    unless,
    when,
  };
};

export type TemplateHelpers = ReturnType<typeof makeHelpers>;
