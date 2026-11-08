import { bcs } from '@mysten/sui/bcs'
import { ManagementSceneBcs, ManagementScopeBcs } from '../soulidity/management/application-bcs'
import { IncomeLedgerBcs } from '../soulidity/commerce/economics-bcs'
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector(),Table=bcs.struct('Table',{id:A,size:U})
const Selector=bcs.struct('Selector',{product:bcs.option(A),version:bcs.option(U),part:V,item:bcs.option(V),style:bcs.option(V)})
const Market=bcs.struct('MarketPolicy',{schema:bcs.u16(),config:A,snapshot_revision:U,platform:A,control_fee_bps:bcs.u16(),equipment_fee_bps:bcs.u16(),control_royalty_bps:bcs.u16(),creator:A})
export const CurrentMakerProductPrimaryBcs=bcs.struct('PrimaryPolicy',{schema:bcs.u16(),config:A,snapshot_revision:U,platform:A,bps:bcs.u16(),complete_fee:U})
const Parent=bcs.struct('ParentSnapshot',{scope:ManagementScopeBcs,policy_hash:V,scene:ManagementSceneBcs,paths:bcs.vector(Selector)})
/** Pure full owning Product layout; table values require their own proofs. */
export const CurrentMakerProductBcs=bcs.struct('Product',{id:A,protocol:A,creator:A,market:Market,primary:CurrentMakerProductPrimaryBcs,maker:bcs.option(A),parent_version:U,parent_snapshot:bcs.option(Parent),version:U,lifecycle:bcs.u8(),versions:Table,access:Table,income:IncomeLedgerBcs,issued:Table,completes:Table,attempts:Table,payments:Table,physical_registries:Table})
