export interface IKid {
  id: string;
  parentId: string;
  name: string;
  age: number;
  grade?: string;
  createdAt: Date;
}