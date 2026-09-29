import type {
  AppendOnlyContractKind,
  ContractFor,
  CoreContractKind,
  DefinitionContractKind,
  MutableContractKind,
  UUID,
} from "./contracts";

export type WritableContractKind = Exclude<CoreContractKind, AppendOnlyContractKind>;

export type ContractScope<K extends CoreContractKind> = K extends DefinitionContractKind
  ? { definition: true }
  : { businessId: UUID };

export type ContractListOptions<K extends CoreContractKind> = ContractScope<K> & {
  limit?: number;
  offset?: number;
};

export interface CoreRepository {
  get<K extends CoreContractKind>(
    kind: K,
    id: UUID,
    scope: ContractScope<K>,
  ): Promise<ContractFor<K> | null>;

  list<K extends CoreContractKind>(
    kind: K,
    options: ContractListOptions<K>,
  ): Promise<readonly ContractFor<K>[]>;

  create<K extends WritableContractKind>(
    kind: K,
    record: ContractFor<K>,
  ): Promise<ContractFor<K>>;

  append<K extends AppendOnlyContractKind>(
    kind: K,
    record: ContractFor<K>,
  ): Promise<ContractFor<K>>;

  update<K extends MutableContractKind>(
    kind: K,
    record: ContractFor<K>,
  ): Promise<ContractFor<K>>;

  transaction<T>(operation: (repository: CoreRepository) => Promise<T>): Promise<T>;
}
