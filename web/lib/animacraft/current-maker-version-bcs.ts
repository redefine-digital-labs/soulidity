import { bcs } from '@mysten/sui/bcs'
import { ManagementAdapterBcs, ManagementDefinitionBcs, ManagementSceneBcs } from '../soulidity/management/application-bcs'

// Pure canonical Version/Policy layouts shared by Creator and Complete.
// No client, package reader, history controller or source qualification.
const A=bcs.Address,U=bcs.u64(),V=bcs.byteVector(),T=bcs.struct('TypeName',{name:bcs.string()}),N=bcs.u16()
const Market=bcs.struct('MarketPolicy',{schema:N,config:A,snapshot_revision:U,platform:A,control_fee_bps:N,equipment_fee_bps:N,control_royalty_bps:N,creator:A})
export const CurrentMakerPrimaryPolicyBcs=bcs.struct('PrimaryPolicy',{schema:N,config:A,snapshot_revision:U,platform:A,bps:N,complete_fee:U})
const Execution=bcs.struct('Execution',{adapter:T,revision:T,target:T}),Physical=bcs.struct('PhysicalExecution',{producer:T,revision:T})
const Context=bcs.struct('PublicationContext',{protocol:A,product:A,version:U,parent:bcs.option(A),parent_version:U,parent_policy:bcs.option(V)})
const Initial=bcs.struct('InitialRule',{kind:bcs.u32(),name:bcs.string(),read_mask:U,download_policy:bcs.u8()})
export const CurrentMakerOutputPolicyBcs=bcs.struct('Policy',{key:V,protected:bcs.bool(),scope:V,renderer:V,all_packs:bcs.bool(),allowed_packs:bcs.vector(V),initials:bcs.vector(Initial)})
const Terms=bcs.struct('Terms',{definition:V,material:V,mode:bcs.u8(),proof:bcs.u8(),price:U,supply:U,transferable:bcs.bool()})
/** Full immutable owning Version, not a partial header/offset projection. */
export const CurrentMakerVersionBcs=bcs.struct('Version',{execution:bcs.option(Execution),physical_execution:bcs.option(Physical),manifest:V,configuration:V,policy_hash:V,publication:bcs.option(Context),
  access_mode:bcs.u8(),access_price:U,completion_mode:bcs.u8(),completion_price:U,quota:U,cap:U,royalty_bps:N,beneficiary:A,soul_rates:bcs.struct('Rates',{oc:N,maker:N}),market:bcs.option(Market),primary:bcs.option(CurrentMakerPrimaryPolicyBcs),
  parts:bcs.vector(V),required_parts:bcs.vector(V),definitions:bcs.vector(ManagementDefinitionBcs),adapters:bcs.vector(ManagementAdapterBcs),scene:ManagementSceneBcs,outputs:bcs.vector(CurrentMakerOutputPolicyBcs),pack_key:V,physical:bcs.vector(Terms)})
